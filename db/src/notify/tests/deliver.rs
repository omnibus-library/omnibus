//! `deliver` against a local server: how each answer is judged, `Retry-After`, and error
//! text that carries the provider's words but never a credential, even one echoed back.

use std::time::Duration;

use wiremock::Request;

use crate::test_support::closed_port_url;

use super::super::test_support::{basic_input, ntfy_input, stored, token_input};
use super::*;

async fn send_to(
    server_url: &str,
    input: omnibus_shared::NtfySettingsInput,
) -> Result<(), DeliverError> {
    let settings = stored(omnibus_shared::NtfySettingsInput {
        server_url: server_url.to_string(),
        ..input
    });
    deliver(&client(), render_test(&settings, None)).await
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
async fn deliver_posts_to_a_sub_path_without_doubling_a_slash() {
    let server = ntfy_answering(ResponseTemplate::new(200)).await;

    let result = send_to(
        &format!("{}/ntfy/", server.uri()),
        ntfy_input("http://unused"),
    )
    .await;

    assert_eq!(result, Ok(()));
    let received = server.received_requests().await.unwrap();
    assert_eq!(received[0].url.path(), "/ntfy");
}

#[tokio::test]
async fn deliver_retries_a_500_naming_the_status_and_body() {
    let (after, message) =
        retry(answer(ResponseTemplate::new(500).set_body_string("disk full")).await);

    assert_eq!(after, None);
    assert_eq!(
        message,
        "the server answered 500 Internal Server Error: disk full"
    );
}

#[tokio::test]
async fn deliver_retries_a_429_after_its_retry_after_seconds() {
    let response = ResponseTemplate::new(429).insert_header("Retry-After", "120");

    let (after, message) = retry(answer(response).await);

    assert_eq!(after, Some(Duration::from_secs(120)));
    assert!(message.contains("429"), "{message}");
}

#[tokio::test]
async fn deliver_caps_a_retry_after_at_an_hour() {
    let response = ResponseTemplate::new(503).insert_header("Retry-After", "999999");

    let (after, _) = retry(answer(response).await);

    assert_eq!(after, Some(Duration::from_secs(3600)));
}

#[tokio::test]
async fn deliver_fails_a_401_and_a_404_at_once() {
    for status in [401, 404] {
        let message = permanent_message(answer(ResponseTemplate::new(status)).await);
        assert!(
            message.starts_with(&format!("the server answered {status}")),
            "{message}"
        );
    }
}

#[tokio::test]
async fn deliver_fails_a_redirect_without_following_it() {
    let response =
        ResponseTemplate::new(301).insert_header("Location", "https://elsewhere.example");

    let message = permanent_message(answer(response).await);

    assert!(message.contains("301"), "{message}");
}

#[tokio::test]
async fn deliver_retries_when_nothing_listens() {
    let (after, message) = retry(send_to(&closed_port_url(), ntfy_input("http://unused")).await);

    assert_eq!(after, None);
    assert!(
        message.starts_with("could not reach the server ("),
        "{message}"
    );
}

#[tokio::test]
async fn deliver_keeps_an_echoed_token_out_of_the_error() {
    let server = echoing_authorization().await;

    let message = permanent_message(
        send_to(
            &server.uri(),
            token_input("http://unused", Some("tk_SECRETTOKEN")),
        )
        .await,
    );

    assert!(!message.contains("tk_SECRETTOKEN"), "{message}");
    assert!(message.contains("[redacted]"), "{message}");
}

#[tokio::test]
async fn deliver_keeps_an_echoed_password_and_its_encoding_out_of_the_error() {
    let server = echoing_authorization().await;
    let input = basic_input("http://unused", Some("ada"), Some("pw-SECRET"));

    let message = permanent_message(send_to(&server.uri(), input).await);

    // base64("ada:pw-SECRET")
    assert!(!message.contains("YWRhOnB3LVNFQ1JFVA=="), "{message}");
    assert!(!message.contains("pw-SECRET"), "{message}");
}

#[tokio::test]
async fn deliver_shortens_a_long_body_to_one_line() {
    let long = format!("first line\n\n{}", "word ".repeat(300));

    let message = permanent_message(answer(ResponseTemplate::new(400).set_body_string(long)).await);

    assert!(message.contains("first line word"), "{message}");
    assert!(message.ends_with('\u{2026}'), "{message}");
    assert!(message.chars().count() < 260, "{message}");
}

#[tokio::test]
async fn deliver_drops_a_token_the_body_read_cut_through() {
    let server = MockServer::start().await;
    let token = "tk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    // Whitespace collapses away, so the cut-off start of the token would be the whole snippet.
    let body = format!("{}{token} and more", " ".repeat(1000));
    Mock::given(wiremock::matchers::method("POST"))
        .respond_with(ResponseTemplate::new(400).set_body_string(body))
        .mount(&server)
        .await;

    let message =
        permanent_message(send_to(&server.uri(), token_input("http://unused", Some(token))).await);

    assert!(!message.contains("tk_ABC"), "{message}");
}
