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
