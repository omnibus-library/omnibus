//! The book-request pipeline's links to the outside world: Prowlarr, the download client
//! the server hands releases to, and the folder mapping that turns its finished files into
//! local ones.
//!
//! The URLs here are the admin's own LAN services (`http://qbittorrent:8080`), so this
//! module deliberately does not use the author-photo SSRF guard that refuses private
//! addresses; its calls go out only to the connections an admin saved.

use std::sync::OnceLock;
use std::time::Duration;

use reqwest::StatusCode;

pub mod clients;
pub mod cover;
pub mod import;
pub mod paths;
pub mod poller;
pub mod prowlarr;
pub mod rank;
pub mod search;
pub mod store;

#[cfg(test)]
mod test_support;

/// Why a call to Prowlarr or the download client failed. Every message is safe to show an
/// admin: none carries a URL, key or password.
#[derive(Debug, thiserror::Error)]
pub enum ConnectionError {
    #[error("not set up yet")]
    NotConfigured,
    #[error("could not connect ({0})")]
    Unreachable(String),
    #[error("the login was rejected")]
    BadLogin,
    #[error("the API key was rejected")]
    BadApiKey,
    #[error("this does not look like a {0} address")]
    BadUrl(String),
    #[error("{0}")]
    Rejected(String),
    #[error("Prowlarr is limiting searches for now")]
    RateLimited,
}

impl ConnectionError {
    /// A transport failure, described without the request URL `reqwest` puts in its text.
    pub fn from_transport(e: &reqwest::Error) -> Self {
        let reason = if e.is_timeout() {
            "timed out"
        } else if e.is_connect() {
            "connection refused or failed"
        } else {
            "request failed"
        };
        ConnectionError::Unreachable(reason.to_string())
    }
}

/// Bound on each request, so a dead service cannot hold a worker.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// The process-wide HTTP client for both connections, built once and cloned. It follows no
/// redirect: one could carry the API key or the login form to another host.
pub fn http_client() -> Result<reqwest::Client, ConnectionError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c.clone());
    }
    let new = reqwest::Client::builder()
        .user_agent(crate::http_client::default_user_agent())
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| ConnectionError::from_transport(&e))?;
    // A pooled connection dies with the `#[tokio::test]` runtime that opened it.
    if cfg!(test) {
        return Ok(new);
    }
    Ok(CLIENT.get_or_init(|| new).clone())
}

/// Map the statuses both services share: 404 is the wrong address, 401 and 403 are
/// `bad_credentials`, and any other failure is a refusal naming `service`.
pub fn check_status(
    status: StatusCode,
    service: &str,
    bad_credentials: ConnectionError,
) -> Result<(), ConnectionError> {
    match status {
        StatusCode::NOT_FOUND => Err(ConnectionError::BadUrl(service.to_string())),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(bad_credentials),
        s if !s.is_success() => Err(ConnectionError::Rejected(format!("{service} answered {s}"))),
        _ => Ok(()),
    }
}
