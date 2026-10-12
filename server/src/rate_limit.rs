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

/// Returns true when the operator has opted in (via `OMNIBUS_TRUST_FORWARDED_FOR={1,true,yes}`)
/// to using the client-supplied `X-Forwarded-For` header as the rate-limit key. `pub` so the
/// entrypoint can warn: enabling it without a trusted reverse proxy lets any client rotate
/// the header per request and defeat the per-IP limiter.
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
    /// Default policy tuned for the auth endpoints: 10 requests per 60 s per IP. Mount on the
    /// auth sub-router via `from_fn_with_state((limiter, prefixes), rate_limit_paths)` with a
    /// prefix allow-list so authenticated reads like `/api/auth/me` are exempt; see
    /// [`rate_limit_paths`] for the expected `prefixes` shape.
    pub fn new() -> Self {
        Self::with_policy(Duration::from_secs(WINDOW_SECS), MAX_REQUESTS)
    }

    /// Construct a limiter with an explicit `(window, max requests)` policy, as the search
    /// family does. Otherwise identical to [`RateLimiter::new`]; the same `Arc` can
    /// be shared across REST and RPC routers ([`rate_limit_by_ip`], [`rate_limit_paths`]) so
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

/// Resolve the request principal IP. With `OMNIBUS_TRUST_FORWARDED_FOR=1` the **rightmost**
/// `X-Forwarded-For` hop wins (the one the trusted proxy appended; the rest is client-chosen),
/// outranking the TCP peer, which behind a proxy *is* the proxy. Without the opt-in the header
/// is never consulted: a client could rotate it to bypass the limiter. Shared with the OPDS
/// Basic-auth extractor and `request_log`'s span, so the log and limiter can't disagree.
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

/// Path-prefix wrapper around [`rate_limit_by_ip`]: a request matching none of the given
/// prefixes passes through, for routers mixing limited and unlimited routes (e.g. the
/// dioxus RPC router, where only `/api/rpc/search-*` is throttled). The bucket map is the
/// passed-in limiter's, so `main.rs` shares one `Arc` with the REST `/api/search/*` layer for
/// one per-IP budget.
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
