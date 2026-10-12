//! Shared process-wide `reqwest::Client` for the Open Library cascade in
//! `author_photos`, built once and cloned so resolutions share one connection
//! pool and TLS session cache. The admin "paste URL" path (`remote.rs`) opts
//! out — it pins `reqwest` to pre-validated addresses for SSRF protection.

use std::sync::OnceLock;

/// Return the crate's default `User-Agent` header value.
pub(super) fn default_user_agent() -> String {
    crate::http_client::default_user_agent()
}

/// Process-wide shared `reqwest::Client`; callers get clones, so cascade
/// resolutions share one connection pool. Set per-request timeouts on the
/// `RequestBuilder`. Never use it for user-supplied URLs: those go through
/// `remote::fetch_remote_image_with`, which pins validated addresses (SSRF).
/// Fallible: propagate the build error with `?`; the next call retries.
pub(super) fn shared_client() -> reqwest::Result<reqwest::Client> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c.clone());
    }
    let new = crate::http_client::build_client(&default_user_agent())?;
    // First-write wins: `get_or_init` returns the existing value if a
    // concurrent caller already initialized `CLIENT`, discarding ours.
    Ok(CLIENT.get_or_init(|| new).clone())
}
