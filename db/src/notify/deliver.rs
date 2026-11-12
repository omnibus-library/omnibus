//! Sending one rendered request and judging the answer: a 2xx is delivered; a 408, 425,
//! 429, 5xx or no answer is worth retrying; anything else never will be. Shared by the outbox and the
//! test route. Every error message is built from the status and a short, scrubbed piece of
//! the provider's body, never from the request, so no URL or credential can reach a log
//! line or a response.

use std::error::Error as _;
use std::time::Duration;

use reqwest::header::RETRY_AFTER;
use reqwest::StatusCode;

use crate::http_client::default_user_agent;

use super::render::Outgoing;

/// How long one send may take, connecting included.
pub const SEND_TIMEOUT: Duration = Duration::from_secs(15);

/// The longest `Retry-After` honoured; a provider asking for more is tried again after this.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(3600);

/// How much of a refusal's body is read, and how much of it an error message quotes.
const BODY_READ_BYTES: usize = 1024;
const SNIPPET_CHARS: usize = 200;

/// Why a send didn't deliver.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DeliverError {
    /// Worth trying again: no answer, a 408, 425, 429 or 5xx. `after` is the provider's
    /// `Retry-After`, when it sent one.
    #[error("{message}")]
    Retry {
        after: Option<Duration>,
        message: String,
    },
    /// Sending it again won't help: any other 4xx, or a redirect.
    #[error("{message}")]
    Permanent { message: String },
}

/// A new client for sending notifications: a [`SEND_TIMEOUT`] on every call, and no
/// redirect, which could carry a credential to another host. The drain loop builds one and
/// keeps it; a test send builds its own.
pub fn http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(default_user_agent())
        .timeout(SEND_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

/// Send `outgoing` and judge the answer.
pub async fn deliver(client: &reqwest::Client, outgoing: Outgoing) -> Result<(), DeliverError> {
    let mut request = client
        .request(outgoing.method, &outgoing.url)
        .body(outgoing.body);
    for (name, value) in &outgoing.headers {
        request = request.header(*name, value);
    }
    let response = request
        .send()
        .await
        .map_err(|e| transport_error(&e, &outgoing.secrets))?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let after = retry_after(response.headers());
    let snippet = body_snippet(response, &outgoing.secrets).await;
    let message = if snippet.is_empty() {
        format!("the server answered {status}")
    } else {
        format!("the server answered {status}: {snippet}")
    };
    let transient = matches!(
        status,
        StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_EARLY | StatusCode::TOO_MANY_REQUESTS
    );
    if transient || status.is_server_error() {
        Err(DeliverError::Retry { after, message })
    } else {
        Err(DeliverError::Permanent { message })
    }
}

/// A send that got no answer, said by its innermost cause: `reqwest`'s own text is where
/// the URL would be.
fn transport_error(e: &reqwest::Error, secrets: &[String]) -> DeliverError {
    if e.is_builder() {
        return DeliverError::Permanent {
            message: "the request could not be built from these settings".to_string(),
        };
    }
    let reason = if e.is_timeout() {
        "timed out".to_string()
    } else {
        innermost_cause(e).map_or_else(
            || "request failed".to_string(),
            |cause| scrub(&cause.to_string(), secrets),
        )
    };
    DeliverError::Retry {
        after: None,
        message: format!("could not reach the server ({reason})"),
    }
}

fn innermost_cause(e: &reqwest::Error) -> Option<&(dyn std::error::Error + 'static)> {
    let mut cause = e.source()?;
    while let Some(inner) = cause.source() {
        cause = inner;
    }
    Some(cause)
}

/// The `Retry-After` seconds a provider sent, capped at [`MAX_RETRY_AFTER`]. The HTTP-date
/// form isn't read, so it falls back to the outbox's own backoff.
fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let seconds: u64 = headers
        .get(RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()?;
    Some(Duration::from_secs(seconds).min(MAX_RETRY_AFTER))
}

/// The start of a refusal's body, scrubbed of `secrets`, on one line and at most
/// [`SNIPPET_CHARS`] long.
async fn body_snippet(mut response: reqwest::Response, secrets: &[String]) -> String {
    let mut bytes = Vec::new();
    let mut cut = false;
    while let Ok(Some(chunk)) = response.chunk().await {
        bytes.extend_from_slice(&chunk);
        if bytes.len() >= BODY_READ_BYTES {
            bytes.truncate(BODY_READ_BYTES);
            cut = true;
            break;
        }
    }
    let mut text = scrub(&String::from_utf8_lossy(&bytes), secrets);
    if cut {
        // A secret the read cut through is not matched whole, so drop as much of the end
        // as the longest secret could leave there.
        let longest = secrets.iter().map(String::len).max().unwrap_or(0);
        let keep = text.floor_char_boundary(text.len().saturating_sub(longest));
        text.truncate(keep);
    }
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= SNIPPET_CHARS && !cut {
        return one_line;
    }
    let mut short: String = one_line.chars().take(SNIPPET_CHARS).collect();
    short.push('\u{2026}');
    short
}

/// `text` with every non-empty secret in it replaced.
fn scrub(text: &str, secrets: &[String]) -> String {
    secrets
        .iter()
        .filter(|secret| !secret.is_empty())
        .fold(text.to_string(), |text, secret| {
            text.replace(secret.as_str(), "[redacted]")
        })
}
