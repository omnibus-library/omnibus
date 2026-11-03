//! The book-request pipeline's links to the outside world: the download client the server
//! hands links to, and the folder mapping that turns its finished files into local ones.
//! The URLs here are the admin's own LAN services (`http://qbittorrent:8080`), so this
//! module deliberately does not use the author-photo SSRF guard that refuses private
//! addresses; its calls go out only to the connections an admin saved.

use std::sync::OnceLock;

pub mod clients;
pub mod paths;

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
}

impl ConnectionError {
    /// A transport failure, described without the request URL `reqwest` puts in its text.
    pub(crate) fn from_transport(e: &reqwest::Error) -> Self {
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

/// The process-wide HTTP client for both connections, built once and cloned.
pub(crate) fn http_client() -> Result<reqwest::Client, ConnectionError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c.clone());
    }
    let new = crate::http_client::build_client(&crate::http_client::default_user_agent())
        .map_err(|e| ConnectionError::from_transport(&e))?;
    Ok(CLIENT.get_or_init(|| new).clone())
}
