//! Global HTTP security response headers, applied to every response served
//! by the axum router (SSR HTML, WASM bundle, server-function responses,
//! the `/api/*` REST surface, static assets) in one place rather than
//! depending on each handler to remember. See [`DEFAULT_CSP`],
//! [`baseline_layers`], and [`hsts_layer`] for the per-header rationale.
//!
//! `script-src` carries `'unsafe-inline'` and `'unsafe-eval'` because the Dioxus web
//! runtime needs both (an inline hydration bootstrap with no nonce, and `Function()` in
//! the interpreter), so it buys almost no injection protection. The CSP's value lives in
//! the other directives: `connect-src 'self'` blocks exfiltration, and `object-src`,
//! `base-uri`, `form-action` and `frame-ancestors` are locked down.

use std::sync::LazyLock;

use axum::http::{header, HeaderName, HeaderValue};
use tower_http::set_header::SetResponseHeaderLayer;

/// Conservative content-security policy that still hydrates Dioxus WASM: defense-in-depth
/// against any XSS gap in SSR-rendered user content (book descriptions are sanitized via
/// `ammonia`). `img-src` lists every provider cover host from [`db::all_cover_hosts`], so
/// adding a provider can't leave its covers silently blocked; once applied, a cover is
/// served same-origin from `/api/covers/:uuid`.
static DEFAULT_CSP: LazyLock<String> = LazyLock::new(build_csp);

/// [`DEFAULT_CSP`] with no provider cover hosts — every other directive
/// identical, so falling back to it can only ever tighten the policy. Serving
/// a shorter policy instead would drop the framing and base-uri guards along
/// with the image hosts.
const NO_PROVIDER_HOSTS_CSP: &str = "default-src 'self'; \
script-src 'self' 'unsafe-inline' 'unsafe-eval'; \
style-src 'self' 'unsafe-inline' blob: https://fonts.googleapis.com; \
img-src 'self' data: blob:; \
font-src 'self' data: https://fonts.gstatic.com; \
connect-src 'self'; \
object-src 'none'; \
base-uri 'self'; \
form-action 'self'; \
frame-ancestors 'none'";

/// Assemble [`DEFAULT_CSP`], splicing the provider cover hosts into
/// `img-src`. Built once behind a `LazyLock` because the host list is a
/// runtime value; every other directive is fixed text.
fn build_csp() -> String {
    let cover_hosts = omnibus_db::all_cover_hosts()
        .into_iter()
        .map(|host| format!(" https://{host}"))
        .collect::<String>();
    // `style-src` needs `blob:` (epub.js renders book stylesheets via `createObjectURL`) and
    // the Google Fonts hosts here and in `font-src` (`atrium.css` `@import`s them); `font-src`
    // also needs `data:` for faces a book embeds.
    format!(
        "default-src 'self'; \
script-src 'self' 'unsafe-inline' 'unsafe-eval'; \
style-src 'self' 'unsafe-inline' blob: https://fonts.googleapis.com; \
img-src 'self' data: blob:{cover_hosts}; \
font-src 'self' data: https://fonts.gstatic.com; \
connect-src 'self'; \
object-src 'none'; \
base-uri 'self'; \
form-action 'self'; \
frame-ancestors 'none'"
    )
}

/// One year, `includeSubDomains`. Standard production HSTS recommendation;
/// preload is intentionally omitted (operator opt-in only).
const DEFAULT_HSTS: &str = "max-age=31536000; includeSubDomains";

/// Build the `(CSP, X-Frame-Options, Referrer-Policy, X-Content-Type-Options)` layers
/// applied unconditionally to every response, as an array so the caller can fold each via
/// repeated `.layer(...)` (axum's `Router` stacks layers one at a time).
pub fn baseline_layers() -> [SetResponseHeaderLayer<HeaderValue>; 4] {
    [
        SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            // Infallible in practice — every host in the catalog is ASCII —
            // but a bad one must degrade to a *strictly stricter* policy, so
            // the fallback is the same directive list minus the provider
            // hosts. Dropping to `default-src 'self'` alone would silently
            // give up `frame-ancestors 'none'`, `base-uri`, and
            // `form-action`, which is looser, not tighter.
            HeaderValue::from_str(&DEFAULT_CSP).unwrap_or_else(|_| {
                tracing::error!(
                    "provider cover hosts are not header-safe; serving the CSP without them"
                );
                HeaderValue::from_static(NO_PROVIDER_HOSTS_CSP)
            }),
        ),
        // Legacy clickjacking guard — `frame-ancestors 'none'` in the CSP
        // supersedes this on modern browsers; both ship for coverage on
        // older clients.
        SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ),
        // Keeps full URLs (which may include search queries or book ids)
        // from leaking to other origins, while preserving same-origin
        // referrers used for analytics on internal navigation.
        SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ),
        // Globally suppresses MIME sniffing. The per-handler `nosniff` on
        // cover/thumb responses in `backend::covers` becomes redundant once
        // this layer is mounted, but stays as belt-and-suspenders.
        SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ),
    ]
}

/// HSTS layer, conditionally constructed: `Some(layer)` when `secure_cookies` is true, `None`
/// otherwise. The caller passes the result of `auth::handlers::parse_secure_cookies`, so HSTS
/// stays pinned to the cookie `Secure` flag; HSTS on a plain-HTTP LAN-IP dev origin
/// (`OMNIBUS_SECURE_COOKIES=0`) would advertise the wrong policy.
pub fn hsts_layer(secure_cookies: bool) -> Option<SetResponseHeaderLayer<HeaderValue>> {
    secure_cookies.then(|| {
        SetResponseHeaderLayer::overriding(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static(DEFAULT_HSTS),
        )
    })
}

#[cfg(test)]
mod tests;
