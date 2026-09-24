//! `Vary: Accept-Encoding` for content-encoded responses. dioxus-server serves
//! the release bundle's precompressed `.br` assets by negotiating on
//! `Accept-Encoding` without saying so, which lets a caching reverse proxy
//! hand brotli to a client that never asked for it. Layered router-wide in
//! `main.rs`, since the static-asset service lives inside dioxus.

use axum::{
    extract::Request,
    http::{header, HeaderMap, HeaderValue},
    middleware::Next,
    response::Response,
};

/// Append `Vary: Accept-Encoding` to any response carrying a `Content-Encoding` that doesn't already vary on it.
pub async fn vary_on_content_encoding(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    if headers.contains_key(header::CONTENT_ENCODING) && !varies_on_encoding(headers) {
        // Append, never insert: media routes already carry their own `Vary`.
        headers.append(header::VARY, HeaderValue::from_static("accept-encoding"));
    }
    res
}

fn varies_on_encoding(headers: &HeaderMap) -> bool {
    headers
        .get_all(header::VARY)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(str::trim)
        .any(|name| name == "*" || name.eq_ignore_ascii_case("accept-encoding"))
}

#[cfg(test)]
mod tests;
