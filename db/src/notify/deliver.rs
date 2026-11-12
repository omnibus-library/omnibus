//! Sending one rendered request and judging the answer: a 2xx is delivered; a 408, 425,
//! 429, 5xx or no answer is worth retrying; anything else never will be. Shared by the
//! outbox and the test route. The error carries the plain sentence [`super::explain`] has
//! for the case, never a status line or the provider's body. The technical detail, the
//! status with a short scrubbed piece of the body or the transport error's innermost cause,
//! goes to one log line per failed send, which never holds the URL or a credential either.

use std::error::Error as _;
use std::time::{Duration, SystemTime};

use reqwest::header::RETRY_AFTER;
use reqwest::StatusCode;

use crate::http_client::default_user_agent;

use super::explain::{self, Unreachable};
use super::render::Outgoing;

/// How long one send may take, connecting included.
pub const SEND_TIMEOUT: Duration = Duration::from_secs(15);

/// The longest `Retry-After` honoured; a provider asking for more is tried again after this.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(3600);

/// How much of a refusal's body is read, and how much of it the log line quotes.
const BODY_READ_BYTES: usize = 1024;
const SNIPPET_CHARS: usize = 200;

/// Why a send didn't deliver. The message is a sentence an admin can read as it is.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DeliverError {
    /// Worth trying again: no answer, a 408, 425, 429 or 5xx. `after` is the provider's
    /// `Retry-After`, when it sent one.
    #[error("{message}")]
    Retry {
        after: Option<Duration>,
        message: String,
    },
    /// Sending it again won't help: any other 4xx, a redirect, or a request that can't be
    /// built.
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
    let provider = outgoing.provider;
    let mut request = client
        .request(outgoing.method, &outgoing.url)
        .body(outgoing.body);
    for (name, value) in &outgoing.headers {
        request = request.header(*name, value);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(e) => return Err(transport_error(provider, &e, &outgoing.secrets)),
    };
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let after = retry_after(response.headers());
    let (body, cut) = read_start(response).await;
    tracing::warn!(
        provider,
        status = status.as_u16(),
        body = %snippet(&body, cut, &outgoing.secrets),
        "a notification provider refused a message"
    );
    let reason = (status == StatusCode::BAD_REQUEST && !cut)
        .then(|| explain::provider_error(&String::from_utf8_lossy(&body), &outgoing.secrets))
        .flatten();
    let message = explain::refusal(provider, status, reason.as_deref());
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

/// A send that got no answer, told by what the error chain shows; a case it can't tell
/// apart reads as a failed connection, or a generic one.
fn transport_error(provider: &str, e: &reqwest::Error, secrets: &[String]) -> DeliverError {
    let chain = causes(e);
    // The innermost cause says what failed; `reqwest`'s own text is where the URL would be.
    let detail = chain.last().map_or_else(
        || "request failed".to_string(),
        |c| scrub(&c.to_string(), secrets),
    );
    tracing::warn!(provider, error = %detail, "couldn't reach a notification provider");
    let why = unreachable_cause(e, &chain);
    let message = explain::unreachable(provider, why);
    if e.is_builder() {
        DeliverError::Permanent { message }
    } else {
        DeliverError::Retry {
            after: None,
            message,
        }
    }
}

/// Which way a send failed to reach its provider.
fn unreachable_cause(
    e: &reqwest::Error,
    chain: &[&(dyn std::error::Error + 'static)],
) -> Unreachable {
    if e.is_timeout() {
        return Unreachable::Timeout;
    }
    if chain
        .iter()
        .any(|c| c.downcast_ref::<rustls::Error>().is_some())
    {
        return Unreachable::Tls;
    }
    // The resolver's error types are private; these are their fixed messages, in hyper-util's
    // connector and in reqwest's resolver.
    if chain.iter().any(|c| {
        let text = c.to_string();
        text == "dns error" || text == "error resolving DNS"
    }) {
        return Unreachable::Dns;
    }
    if e.is_connect() {
        return Unreachable::Connect;
    }
    Unreachable::Other
}

/// Every error under `e`, outermost first. An `io::Error`'s `source` skips the error it
/// wraps, such as a TLS one, so the walk steps into that error instead.
fn causes(e: &reqwest::Error) -> Vec<&(dyn std::error::Error + 'static)> {
    let mut chain = Vec::new();
    let mut next = e.source();
    while let Some(cause) = next {
        chain.push(cause);
        next = match cause
            .downcast_ref::<std::io::Error>()
            .and_then(std::io::Error::get_ref)
        {
            Some(wrapped) => Some(wrapped as &(dyn std::error::Error + 'static)),
            None => cause.source(),
        };
    }
    chain
}

/// The wait a provider's `Retry-After` header asks for, as of now.
fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    retry_after_at(headers.get(RETRY_AFTER)?.to_str().ok()?, SystemTime::now())
}

/// The wait a `Retry-After` value asks for as of `now`: delay-seconds, or a date in any of
/// the three forms RFC 9110 has recipients accept (IMF-fixdate, RFC 850 and asctime). A
/// date already past asks for none, a longer wait is capped at [`MAX_RETRY_AFTER`], and
/// anything else is `None`.
pub(super) fn retry_after_at(value: &str, now: SystemTime) -> Option<Duration> {
    let value = value.trim();
    let wait = match value.parse::<u64>() {
        Ok(seconds) => Duration::from_secs(seconds),
        Err(_) => httpdate::parse_http_date(value)
            .ok()?
            .duration_since(now)
            .unwrap_or(Duration::ZERO),
    };
    Some(wait.min(MAX_RETRY_AFTER))
}

/// The first [`BODY_READ_BYTES`] of a refusal's body, and whether there was more.
async fn read_start(mut response: reqwest::Response) -> (Vec<u8>, bool) {
    let mut bytes = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        bytes.extend_from_slice(&chunk);
        if bytes.len() >= BODY_READ_BYTES {
            bytes.truncate(BODY_READ_BYTES);
            return (bytes, true);
        }
    }
    (bytes, false)
}

/// The start of a refusal's body for the log: scrubbed of `secrets`, on one line and at
/// most [`SNIPPET_CHARS`] long. `cut` says the read stopped before the body's end.
pub(super) fn snippet(body: &[u8], cut: bool, secrets: &[String]) -> String {
    let mut text = scrub(&String::from_utf8_lossy(body), secrets);
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
pub(super) fn scrub(text: &str, secrets: &[String]) -> String {
    secrets
        .iter()
        .filter(|secret| !secret.is_empty())
        .fold(text.to_string(), |text, secret| {
            text.replace(secret.as_str(), "[redacted]")
        })
}
