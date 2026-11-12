//! `deliver` against a local server: how each answer and each failure to reach the server
//! is judged and told in its sentence, `Retry-After`, and the scrubbed snippet the log line
//! carries, which never holds a credential even when the provider echoes one back.

use std::time::Duration;

use wiremock::Request;

use crate::test_support::closed_port_url;

use super::super::deliver::{scrub, snippet};
use super::super::test_support::{basic_input, ntfy_input, stored, token_input};
use super::*;

async fn send_with(
    client: &reqwest::Client,
    server_url: &str,
    input: omnibus_shared::NtfySettingsInput,
) -> Result<(), DeliverError> {
    let settings = stored(omnibus_shared::NtfySettingsInput {
        server_url: server_url.to_string(),
        ..input
    });
    deliver(client, render_test(&settings, None)).await
}

async fn send_to(
    server_url: &str,
    input: omnibus_shared::NtfySettingsInput,
) -> Result<(), DeliverError> {
    send_with(&client(), server_url, input).await
}

async fn answer(response: ResponseTemplate) -> Result<(), DeliverError> {
    let server = ntfy_answering(response).await;
    send_to(&server.uri(), ntfy_input("http://unused")).await
}

fn permanent_message(result: Result<(), DeliverError>) -> String {
    match result {
        Err(DeliverError::Permanent { message }) => message,
        other => panic!("expected a permanent failure, got {other:?}"),
    }
}

fn retry(result: Result<(), DeliverError>) -> (Option<Duration>, String) {
    match result {
        Err(DeliverError::Retry { after, message }) => (after, message),
        other => panic!("expected a retry, got {other:?}"),
    }
}

/// A server that answers 401 with the request's `Authorization` header in its body.
async fn echoing_authorization() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .respond_with(|request: &Request| {
            let auth = request
                .headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_string();
            ResponseTemplate::new(401).set_body_string(format!("unauthorized: {auth}"))
        })
        .mount(&server)
        .await;
    server
}

const SIGN_IN: &str =
    "ntfy refused the sign-in. Check the access token, or the username and password.";

#[test]
fn http_client_builds() {
    assert!(http_client().is_ok());
}

#[tokio::test]
async fn deliver_succeeds_when_the_server_answers_200() {
    let server = ntfy_answering(ResponseTemplate::new(200)).await;

    let result = send_to(&server.uri(), token_input("http://unused", Some("tk_abc"))).await;

    assert_eq!(result, Ok(()));
    let received = server.received_requests().await.unwrap();
    assert_eq!(received.len(), 1);
    assert_eq!(
        received[0].headers.get("authorization").unwrap(),
        "Bearer tk_abc"
    );
    let sent: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();
    assert_eq!(sent["title"], "Test notification from Omnibus");
}

#[tokio::test]
async fn deliver_posts_to_a_sub_path_as_given_with_or_without_its_slash() {
    for sub_path in ["/ntfy/", "/ntfy"] {
        let server = ntfy_answering(ResponseTemplate::new(200)).await;

        let url = format!("{}{sub_path}", server.uri());
        let result = send_to(&url, ntfy_input("http://unused")).await;

        assert_eq!(result, Ok(()));
        let received = server.received_requests().await.unwrap();
        assert_eq!(received[0].url.path(), sub_path);
    }
}

mod refusals {
    use super::*;

    #[tokio::test]
    async fn deliver_fails_each_lasting_refusal_at_once_with_its_sentence() {
        let cases = [
            (400, "ntfy couldn't read the message."),
            (401, SIGN_IN),
            (403, "ntfy didn't let this sign-in post to the topic. Check that the token or account can write to it."),
            (404, "Nothing at that address takes ntfy messages. Check the server URL."),
            (413, "ntfy refused the message as too large."),
            (418, "ntfy refused the message (HTTP 418)."),
        ];
        for (status, sentence) in cases {
            let message = permanent_message(answer(ResponseTemplate::new(status)).await);
            assert_eq!(message, sentence, "{status}");
        }
    }

    #[tokio::test]
    async fn deliver_retries_each_passing_refusal_with_its_sentence() {
        let cases = [
            (408, "ntfy refused the message (HTTP 408)."),
            (425, "ntfy refused the message (HTTP 425)."),
            (429, "ntfy is limiting how often Omnibus can post."),
            (
                500,
                "The ntfy server had a problem and couldn't take the message (HTTP 500).",
            ),
            (
                503,
                "The ntfy server had a problem and couldn't take the message (HTTP 503).",
            ),
        ];
        for (status, sentence) in cases {
            let body = ResponseTemplate::new(status).set_body_string("disk full");
            let (after, message) = retry(answer(body).await);
            assert_eq!(message, sentence, "{status}");
            assert_eq!(after, None, "{status}");
        }
    }

    #[tokio::test]
    async fn deliver_fails_a_redirect_without_following_it() {
        let response =
            ResponseTemplate::new(301).insert_header("Location", "https://elsewhere.example");

        let message = permanent_message(answer(response).await);

        assert_eq!(
            message,
            "The server URL redirects elsewhere. Use the address it redirects to."
        );
    }

    #[tokio::test]
    async fn deliver_quotes_a_400s_own_short_plain_reason() {
        let body = serde_json::json!({ "code": 40001, "error": "Invalid topic." });

        let message =
            permanent_message(answer(ResponseTemplate::new(400).set_body_json(body)).await);

        assert_eq!(message, "ntfy couldn't read the message: Invalid topic.");
    }

    #[tokio::test]
    async fn deliver_never_quotes_a_400s_reason_that_is_not_a_plain_phrase() {
        let body = serde_json::json!({ "error": "invalid request: priority <b>9</b>" });

        let message =
            permanent_message(answer(ResponseTemplate::new(400).set_body_json(body)).await);

        assert_eq!(message, "ntfy couldn't read the message.");
    }

    #[tokio::test]
    async fn deliver_retries_a_429_after_its_retry_after_seconds() {
        let response = ResponseTemplate::new(429).insert_header("Retry-After", "120");

        let (after, _) = retry(answer(response).await);

        assert_eq!(after, Some(Duration::from_secs(120)));
    }

    #[tokio::test]
    async fn deliver_caps_a_retry_after_at_an_hour() {
        let response = ResponseTemplate::new(503).insert_header("Retry-After", "999999");

        let (after, _) = retry(answer(response).await);

        assert_eq!(after, Some(Duration::from_secs(3600)));
    }

    #[tokio::test]
    async fn deliver_keeps_an_echoed_token_out_of_the_error() {
        let server = echoing_authorization().await;
        let input = token_input("http://unused", Some("tk_SECRETTOKEN"));

        let message = permanent_message(send_to(&server.uri(), input).await);

        assert_eq!(message, SIGN_IN);
    }

    #[tokio::test]
    async fn deliver_keeps_an_echoed_password_and_its_encoding_out_of_the_error() {
        let server = echoing_authorization().await;
        let input = basic_input("http://unused", Some("ada"), Some("pw-SECRET"));

        let message = permanent_message(send_to(&server.uri(), input).await);

        assert_eq!(message, SIGN_IN);
    }
}

mod unreachable {
    use super::*;

    #[tokio::test]
    async fn deliver_retries_when_nothing_listens() {
        let (after, message) =
            retry(send_to(&closed_port_url(), ntfy_input("http://unused")).await);

        assert_eq!(after, None);
        assert_eq!(
            message,
            "Couldn't connect to the ntfy server. Check the server URL and that the server is running."
        );
    }

    #[tokio::test]
    async fn deliver_retries_when_the_host_name_does_not_resolve() {
        let (_, message) =
            retry(send_to("http://ntfy.omnibus.invalid", ntfy_input("http://unused")).await);

        assert_eq!(
            message,
            "Couldn't find the ntfy server. Check the server URL."
        );
    }

    #[tokio::test]
    async fn deliver_retries_when_the_server_does_not_answer_in_time() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        // Accepts and holds every connection without a word.
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((socket, _)) = listener.accept().await {
                held.push(socket);
            }
        });
        let impatient = reqwest::Client::builder()
            .timeout(Duration::from_millis(200))
            .build()
            .unwrap();

        let result = send_with(
            &impatient,
            &format!("http://{address}"),
            ntfy_input("http://unused"),
        )
        .await;

        let (_, message) = retry(result);
        assert_eq!(message, "The ntfy server didn't answer in time.");
    }

    #[tokio::test]
    async fn deliver_retries_when_no_secure_connection_can_be_made() {
        // A plain-HTTP server addressed over https fails the TLS handshake.
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        let https = server.uri().replacen("http://", "https://", 1);

        let (_, message) = retry(send_to(&https, ntfy_input("http://unused")).await);

        assert_eq!(
            message,
            "Couldn't make a secure connection to the ntfy server. Check its certificate."
        );
    }
}

mod log_snippet {
    use super::*;

    fn secrets(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn scrub_replaces_every_secret_and_ignores_an_empty_one() {
        let scrubbed = scrub(
            "Bearer tk_abc and tk_abc again, pw",
            &secrets(&["tk_abc", "", "pw"]),
        );

        assert_eq!(
            scrubbed,
            "Bearer [redacted] and [redacted] again, [redacted]"
        );
    }

    #[test]
    fn snippet_keeps_a_short_body_on_one_line_without_its_secrets() {
        let body = b"unauthorized:\n  Bearer tk_abc\n";

        assert_eq!(
            snippet(body, false, &secrets(&["tk_abc"])),
            "unauthorized: Bearer [redacted]"
        );
    }

    #[test]
    fn snippet_shortens_a_long_body() {
        let long = format!("first line\n\n{}", "word ".repeat(300));

        let short = snippet(long.as_bytes(), false, &[]);

        assert!(short.starts_with("first line word"), "{short}");
        assert!(short.ends_with('\u{2026}'), "{short}");
        assert_eq!(short.chars().count(), 201);
    }

    #[test]
    fn snippet_drops_a_secret_the_read_cut_through() {
        let token = "tk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        // Whitespace collapses away, so the cut-off start of the token would be all that shows.
        let read = format!("{}{}", " ".repeat(1000), &token[..24]);

        let shown = snippet(read.as_bytes(), true, &secrets(&[token]));

        assert!(!shown.contains("tk_ABC"), "{shown}");
    }
}

mod retry_after_at {
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use super::super::super::deliver::retry_after_at;

    /// Sun, 06 Nov 1994 08:49:37 GMT, the date RFC 9110 writes in each form.
    fn rfc_date() -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(784_111_777)
    }

    fn two_minutes_before() -> SystemTime {
        rfc_date() - Duration::from_secs(120)
    }

    #[test]
    fn retry_after_at_reads_delay_seconds() {
        assert_eq!(
            retry_after_at(" 120 ", SystemTime::now()),
            Some(Duration::from_secs(120))
        );
    }

    #[test]
    fn retry_after_at_reads_each_http_date_form_as_the_time_until_it() {
        for date in [
            "Sun, 06 Nov 1994 08:49:37 GMT",
            "Sunday, 06-Nov-94 08:49:37 GMT",
            "Sun Nov  6 08:49:37 1994",
        ] {
            assert_eq!(
                retry_after_at(date, two_minutes_before()),
                Some(Duration::from_secs(120)),
                "{date}"
            );
        }
    }

    #[test]
    fn retry_after_at_asks_for_no_wait_when_the_date_has_passed() {
        let later = rfc_date() + Duration::from_secs(60);

        assert_eq!(
            retry_after_at("Sun, 06 Nov 1994 08:49:37 GMT", later),
            Some(Duration::ZERO)
        );
    }

    #[test]
    fn retry_after_at_caps_a_far_date_and_a_long_delay_at_an_hour() {
        let ten_days_before = rfc_date() - Duration::from_secs(10 * 24 * 3600);

        assert_eq!(
            retry_after_at("Sun, 06 Nov 1994 08:49:37 GMT", ten_days_before),
            Some(Duration::from_secs(3600))
        );
        assert_eq!(
            retry_after_at("999999", ten_days_before),
            Some(Duration::from_secs(3600))
        );
    }

    #[test]
    fn retry_after_at_reads_garbage_or_nothing_as_none() {
        for value in ["soon", "", "-5", "1.5", "Sun, 06 Nov 1994"] {
            assert_eq!(
                retry_after_at(value, two_minutes_before()),
                None,
                "{value:?}"
            );
        }
    }
}
