//! The sentences a failed send is told in: the provider's label in each, and which of a
//! 400's own reasons is quoted.

use reqwest::StatusCode;

use super::super::explain::{provider_error, refusal, unreachable, Unreachable};

fn reason(body: &serde_json::Value) -> Option<String> {
    provider_error(&body.to_string(), &[])
}

#[test]
fn refusal_names_the_provider_it_is_given() {
    assert_eq!(
        refusal("gotify", StatusCode::NOT_FOUND, None),
        "Nothing at that address takes gotify messages. Check the server URL."
    );
    assert_eq!(
        refusal("gotify", StatusCode::BAD_REQUEST, Some("bad title")),
        "gotify couldn't read the message: bad title."
    );
}

#[test]
fn unreachable_names_the_provider_it_is_given() {
    assert_eq!(
        unreachable("gotify", Unreachable::Other),
        "Couldn't reach the gotify server."
    );
}

#[test]
fn provider_error_quotes_a_short_plain_reason_without_its_period() {
    let body = serde_json::json!({ "error": " invalid topic, try another. " });

    assert_eq!(reason(&body).as_deref(), Some("invalid topic, try another"));
}

#[test]
fn provider_error_refuses_anything_but_a_short_plain_string_error() {
    let refused = [
        serde_json::json!({ "error": "invalid request: priority invalid" }),
        serde_json::json!({ "error": "x".repeat(81) }),
        serde_json::json!({ "error": "" }),
        serde_json::json!({ "error": 40001 }),
        serde_json::json!({ "message": "invalid topic" }),
        serde_json::json!(["invalid topic"]),
    ];
    for body in refused {
        assert_eq!(reason(&body), None, "{body}");
    }
    assert_eq!(provider_error("invalid topic", &[]), None);
}

#[test]
fn provider_error_refuses_a_reason_that_echoes_a_secret() {
    let body = serde_json::json!({ "error": "wrong password hunter" }).to_string();

    assert_eq!(provider_error(&body, &["hunter".to_string()]), None);
}

#[test]
fn provider_error_refuses_an_echoed_secret_its_trimming_would_cut_short() {
    for (error, secret) in [
        ("wrong password hunter2.", "hunter2."),
        ("wrong password pass word ", "pass word "),
    ] {
        let body = serde_json::json!({ "error": error }).to_string();

        assert_eq!(
            provider_error(&body, &[secret.to_string()]),
            None,
            "{error:?}"
        );
    }
}

#[test]
fn unreachable_tells_a_failed_secure_connection_to_check_the_scheme_too() {
    assert_eq!(
        unreachable("ntfy", Unreachable::Tls),
        "Couldn't make a secure connection to the ntfy server. Check its certificate, or use http:// if the server doesn't use HTTPS."
    );
}
