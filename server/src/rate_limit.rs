//! Reusable in-memory per-IP rate limiter and axum middleware.
//!
//! Fixed-window counter keyed on the request's peer IP — or, with
//! `OMNIBUS_TRUST_FORWARDED_FOR=1`, on the rightmost `X-Forwarded-For` hop.
//! Mounted per-router in `server/src/main.rs`.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    extract::{ConnectInfo, Request, State},
    http::{self, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use tokio::sync::Mutex;

/// Default window for the auth-endpoint limiter.
pub const WINDOW_SECS: u64 = 60;
/// Default max requests per window for the auth-endpoint limiter.
pub const MAX_REQUESTS: u32 = 10;
/// Maximum number of tracked IPs before stale buckets are pruned.
const MAX_BUCKETS: usize = 10_000;

/// Returns true when the operator has opted in to consulting the client-supplied
/// `X-Forwarded-For` header as the rate-limit key (via
/// `OMNIBUS_TRUST_FORWARDED_FOR={1,true,yes}`). Exposed `pub` so the server
/// entrypoint can emit a startup warning — enabling this without a trusted
/// reverse proxy in front of Axum lets any client rotate the header per
/// request and defeats the per-IP limiter entirely.
pub fn trust_forwarded_for() -> bool {
    matches!(
        std::env::var("OMNIBUS_TRUST_FORWARDED_FOR").as_deref(),
        Ok("1" | "true" | "yes")
    )
}

struct Bucket {
    window_start: Instant,
    count: u32,
}

/// `tokio::sync::Mutex` is used here rather than `std::sync::Mutex` so that
/// `allow()` never blocks a Tokio worker thread while waiting for the lock
/// under contention.
pub struct RateLimiter {
    inner: Mutex<HashMap<IpAddr, Bucket>>,
    window: Duration,
    max: u32,
}

impl RateLimiter {
    /// Default policy tuned for the auth endpoints: 10 requests per 60 s per IP.
    ///
    /// Mount on the auth sub-router via
    /// `from_fn_with_state((limiter, prefixes), rate_limit_paths)` with a
    /// prefix allow-list so authenticated reads like `/api/auth/me` are
    /// exempt — see [`rate_limit_paths`] for the expected `prefixes` shape.
    pub fn new() -> Self {
        Self::with_policy(Duration::from_secs(WINDOW_SECS), MAX_REQUESTS)
    }

    /// Construct a limiter with an explicit `(window, max requests)` policy.
    ///
    /// Used by the search family with a tighter budget (30 / 10s). The
    /// returned limiter is otherwise identical to [`RateLimiter::new`] —
    /// the same `Arc` can be shared across REST and RPC routers (via
    /// [`rate_limit_by_ip`] and [`rate_limit_paths`] respectively) so
    /// both consume from one per-IP budget.
    pub fn with_policy(window: Duration, max: u32) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            window,
            max,
        }
    }

    /// Record a request from `ip`; returns `false` once the per-IP bucket exceeds `max` within `window`.
    pub async fn allow(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut map = self.inner.lock().await;

        // Prune stale entries when the map gets large to prevent unbounded growth.
        if map.len() >= MAX_BUCKETS {
            let window = self.window;
            map.retain(|_, b| now.duration_since(b.window_start) < window * 2);
        }

        let bucket = map.entry(ip).or_insert(Bucket {
            window_start: now,
            count: 0,
        });
        if now.duration_since(bucket.window_start) >= self.window {
            bucket.window_start = now;
            bucket.count = 0;
        }
        if bucket.count >= self.max {
            return false;
        }
        bucket.count += 1;
        true
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

/// Resolve the request principal IP — see [`client_ip`] for the actual policy.
fn resolve_ip(req: &Request) -> IpAddr {
    client_ip(req.extensions(), req.headers())
}

/// Resolve the request principal IP.
///
/// With `OMNIBUS_TRUST_FORWARDED_FOR=1` the **rightmost** `X-Forwarded-For`
/// hop wins: that is the one the trusted proxy appended, and everything to
/// its left is whatever the client chose to send. It has to outrank the TCP
/// peer too — behind a proxy that peer *is* the proxy, so preferring it
/// would hand the whole internet one bucket. Without the opt-in the header
/// is never consulted, because on a directly-reachable deployment a client
/// could rotate it per request to bypass the limiter and grow the bucket map
/// without bound.
///
/// Used by the OPDS Basic-auth extractor (which meters credential
/// verification per IP) and by `request_log`'s span, so the log and the
/// limiter can never disagree about who a request came from.
pub(crate) fn client_ip(extensions: &http::Extensions, headers: &http::HeaderMap) -> IpAddr {
    if trust_forwarded_for() {
        if let Some(ip) = trusted_forwarded_hop(headers) {
            return ip;
        }
    }
    extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(a)| a.ip())
        .unwrap_or_else(|| {
            warn_missing_connect_info();
            IpAddr::V4(Ipv4Addr::UNSPECIFIED)
        })
}

/// The last hop of the last `X-Forwarded-For` header line — the only element
/// the nearest proxy vouches for. `get_all`, not `get`: a proxy may append
/// its own line rather than extend the existing one.
fn trusted_forwarded_hop(headers: &http::HeaderMap) -> Option<IpAddr> {
    let line = headers
        .get_all("x-forwarded-for")
        .iter()
        .next_back()?
        .to_str()
        .ok()?;
    line.rsplit_once(',')
        .map_or(line, |(_, last)| last)
        .trim()
        .parse()
        .ok()
}

/// One WARN, ever, when no peer address reached the limiter: every request
/// then shares one bucket, which is how the per-IP throttle silently became
/// process-wide. A dioxus bump that stops handing the server a make-service
/// with connect info has to be loud rather than invisible.
fn warn_missing_connect_info() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        tracing::warn!(
            target: "omnibus::startup",
            "no ConnectInfo<SocketAddr> on the request \u{2014} every client shares one rate-limit bucket"
        );
    });
}

/// Generic per-IP rate-limit middleware. Apply to whichever sub-router needs
/// limiting — the middleware does no path filtering of its own. Returns
/// `429 Too Many Requests` once the limiter's policy is exceeded; otherwise
/// passes the request through.
pub async fn rate_limit_by_ip(
    State(limiter): State<Arc<RateLimiter>>,
    req: Request,
    next: Next,
) -> Response {
    let ip = resolve_ip(&req);
    if !limiter.allow(ip).await {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded").into_response();
    }
    next.run(req).await
}

/// Path-prefix wrapper around [`rate_limit_by_ip`]. The middleware ignores
/// (passes through) any request whose path doesn't match one of the given
/// prefixes — handy when a top-level router contains a mix of routes and
/// only a subset should be limited (e.g. the dioxus fullstack RPC router,
/// where we only want to throttle `/api/rpc/search-*`).
///
/// Bucket map is shared with whatever limiter is passed in. `main.rs` passes the
/// *same* `Arc` here and to the REST `/api/search/*` layer so both search
/// families share one per-IP budget.
///
/// The auth sub-router mounts this with a prefix allow-list of
/// `/api/auth/login`, `/api/auth/register`, and `/api/auth/logout`.
/// `/api/auth/me` is deliberately omitted from the allow-list: it is an
/// authenticated read of the caller's own row and presents no brute-force
/// surface, so sharing the auth bucket with credential endpoints would
/// throttle legitimate UI boots (and parallel Playwright workers from the
/// loopback IP) for no security gain.
pub async fn rate_limit_paths(
    State((limiter, prefixes)): State<(Arc<RateLimiter>, Arc<Vec<&'static str>>)>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path();
    if !prefixes.iter().any(|p| path.starts_with(p)) {
        return next.run(req).await;
    }
    let ip = resolve_ip(&req);
    if !limiter.allow(ip).await {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded").into_response();
    }
    next.run(req).await
}

#[cfg(test)]
mod tests;
