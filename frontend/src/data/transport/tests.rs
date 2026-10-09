//! Transport tests: the server-fn 401 classifier and auth-state ping, and the mobile 401 token-clear and bearer plumbing.

use super::*;

#[cfg(all(not(feature = "mobile"), any(feature = "web", feature = "server")))]
mod server_fn {
    use dioxus::fullstack::ServerFnError;

    use super::*;

    #[test]
    fn note_server_fn_err_maps_a_401_to_unauthorized_and_flips_the_auth_state_channel() {
        web_auth_state::notify_authorized();
        let rx = web_auth_state::subscribe();
        let e: dioxus::CapturedError = ServerFnError::ServerError {
            message: "session expired".into(),
            code: 401,
            details: None,
        }
        .into();

        assert!(matches!(note_server_fn_err(e), DataError::Unauthorized));
        assert!(!*rx.borrow(), "a 401 must publish logged-out");
    }

    #[test]
    fn note_server_fn_err_surfaces_the_handlers_own_message_for_other_server_errors() {
        let e: dioxus::CapturedError = ServerFnError::ServerError {
            message: "username taken".into(),
            code: 409,
            details: None,
        }
        .into();

        match note_server_fn_err(e) {
            DataError::Other(msg) => assert_eq!(msg, "username taken"),
            other => panic!("a 409 classified as {other:?}"),
        }
    }

    #[test]
    fn note_server_fn_err_stringifies_a_failure_that_is_not_a_server_error() {
        let e: dioxus::CapturedError =
            ServerFnError::Deserialization("unexpected end of input".into()).into();

        match note_server_fn_err(e) {
            DataError::Other(msg) => assert!(
                msg.contains("unexpected end of input"),
                "stringified error lost its cause: {msg}"
            ),
            other => panic!("a deserialization failure classified as {other:?}"),
        }
    }
}

#[cfg(feature = "mobile")]
mod mobile {
    use omnibus_db::test_support::EnvVarGuard;
    use reqwest::header::AUTHORIZATION;
    use reqwest::StatusCode;

    use super::*;

    /// A canned server answer, built without a socket.
    fn response(status: u16, body: &'static str) -> reqwest::Response {
        reqwest::Response::from(
            axum::http::Response::builder()
                .status(status)
                .body(body)
                .unwrap(),
        )
    }

    #[test]
    fn note_status_clears_the_bearer_token_and_signals_logged_out_on_a_401() {
        let _env = EnvVarGuard::set("HOME", None);
        token_store::set("bearer-1".into());
        let mut rx = token_store::subscribe();
        rx.mark_unchanged();

        assert_eq!(
            note_status(StatusCode::UNAUTHORIZED),
            StatusCode::UNAUTHORIZED
        );

        assert_eq!(token_store::get(), None);
        assert!(matches!(rx.has_changed(), Ok(true)));
        assert!(!*rx.borrow(), "a 401 must publish logged-out");
    }

    #[test]
    fn note_status_keeps_the_bearer_token_on_a_403() {
        let _env = EnvVarGuard::set("HOME", None);
        token_store::set("bearer-1".into());

        assert_eq!(note_status(StatusCode::FORBIDDEN), StatusCode::FORBIDDEN);

        // A permission refusal must not log the device out.
        assert_eq!(token_store::get().as_deref(), Some("bearer-1"));
        token_store::clear();
    }

    #[tokio::test]
    async fn drain_error_maps_a_401_to_unauthorized() {
        let err = drain_error(response(401, "expired"), StatusCode::UNAUTHORIZED).await;

        assert!(matches!(err, DataError::Unauthorized), "got {err:?}");
    }

    #[tokio::test]
    async fn drain_error_keeps_the_status_and_server_body_for_other_failures() {
        let err = drain_error(response(409, "username taken"), StatusCode::CONFLICT).await;

        match err {
            DataError::Http { status, body } => {
                assert_eq!(status, 409);
                assert_eq!(body, "username taken");
            }
            other => panic!("a 409 classified as {other:?}"),
        }
    }

    #[test]
    fn encode_query_value_passes_unreserved_bytes_and_percent_encodes_the_rest() {
        assert_eq!(encode_query_value("AZaz09-_.~"), "AZaz09-_.~");
        assert_eq!(
            encode_query_value("1714557600:42 a&b=c/é"),
            "1714557600%3A42%20a%26b%3Dc%2F%C3%A9"
        );
    }

    #[test]
    fn with_bearer_attaches_the_stored_token() {
        let _env = EnvVarGuard::set("HOME", None);
        token_store::set("bearer-1".into());

        let req = with_bearer(http_client().get("http://127.0.0.1:1/x"))
            .build()
            .unwrap();

        assert_eq!(req.headers().get(AUTHORIZATION).unwrap(), "Bearer bearer-1");
        token_store::clear();
    }

    #[test]
    fn with_bearer_sends_no_authorization_header_when_logged_out() {
        let _env = EnvVarGuard::set("HOME", None);
        token_store::clear();

        let req = with_bearer(http_client().get("http://127.0.0.1:1/x"))
            .build()
            .unwrap();

        assert!(req.headers().get(AUTHORIZATION).is_none());
    }
}
