//! The transport-level [`DataError`] type shared by every data wrapper,
//! plus the flatten-to-text helper UI surfaces use to render one.

/// Errors surfaced by the feature-gated data transport, so callers can
/// distinguish failure modes by type: most importantly `Unauthorized`, which
/// the mobile 401 handler and the web router both key on. Variants carrying a
/// foreign error type (`reqwest`, `serde_json`) are feature-gated with their
/// deps; `Unauthorized`, `Http` and `Other` are always present.
#[derive(Debug, thiserror::Error)]
pub enum DataError {
    /// `reqwest`-level failure on the mobile transport: connect / timeout /
    /// TLS **and** response-body decode errors (`response.json()` surfaces a
    /// malformed body as a `reqwest::Error`), so a mobile decode failure lands
    /// here, not in [`DataError::Decode`], which only the web/SSR path produces.
    #[cfg(feature = "mobile")]
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    /// The server responded with a non-success status (other than 401, which
    /// maps to [`DataError::Unauthorized`]). `body` carries the server's
    /// diagnostic text so callers that surface it — e.g. the register-error
    /// classifier — keep working.
    #[error("server returned {status}")]
    Http { status: u16, body: String },
    /// Response body could not be deserialized into the expected type.
    #[cfg(any(feature = "mobile", feature = "web"))]
    #[error("response deserialization failed: {0}")]
    Decode(#[from] serde_json::Error),
    /// Authentication failed (HTTP 401). Distinct variant so the 401 →
    /// clear-token → redirect-to-/login flow can pattern-match instead of
    /// re-inspecting a raw status code.
    #[error("unauthorized")]
    Unauthorized,
    /// Fast-fail result when the client already knows the server is
    /// unreachable (`offline::sync::is_offline()`) and skipped the network
    /// entirely. Unconditional (like [`DataError::Unauthorized`]) so the
    /// enum shape is stable across feature builds.
    #[error("You're offline")]
    Offline,
    /// Catch-all for transport paths that don't carry a typed source —
    /// the web server-function client (whose error is already stringified
    /// by `note_server_fn_err`), the `gloo-net` web/SSR stubs, and a couple
    /// of protocol invariants (missing JSON field, absent bearer token).
    #[error("{0}")]
    Other(String),
}

impl DataError {
    /// `true` when this represents an authentication failure. Lets callers
    /// branch on auth without depending on a specific HTTP code.
    pub fn is_unauthorized(&self) -> bool {
        matches!(self, DataError::Unauthorized)
    }
}

/// Flatten a [`DataError`] into diagnostic text for a UI surface that treats
/// the server body as user-facing. An HTTP failure splices the response body
/// back in (`DataError`'s own `Display` omits it), so a 409/403 renders its
/// actual reason; other variants use their `Display`. Not a default: some
/// contexts (e.g. offline downloads) avoid echoing raw server bodies.
pub fn server_error_message(err: &DataError) -> String {
    match err {
        DataError::Http { status, body } if !body.is_empty() => format!("{status}: {body}"),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests;
