//! Tests for the per-IP rate limiter: window/max enforcement, per-IP bucket
//! isolation, window reset, prefix-scoped middleware pass-through, the
//! shared-budget wiring between REST and RPC search, the auth-router
//! allow-list, bucket pruning at capacity, and `client_ip` resolution.

use super::*;
use omnibus_db::test_support::EnvVarGuard;

#[tokio::test]
async fn rate_limiter_allow_up_to_max_then_blocks() {
    let rl = RateLimiter::with_policy(Duration::from_secs(60), 3);
    let ip: IpAddr = "127.0.0.1".parse().unwrap();
    assert!(rl.allow(ip).await);
    assert!(rl.allow(ip).await);
    assert!(rl.allow(ip).await);
    assert!(!rl.allow(ip).await);
}

#[tokio::test]
async fn rate_limiter_allow_separate_ips_have_separate_buckets() {
    let rl = RateLimiter::with_policy(Duration::from_secs(60), 1);
    let a: IpAddr = "127.0.0.1".parse().unwrap();
    let b: IpAddr = "127.0.0.2".parse().unwrap();
    assert!(rl.allow(a).await);
    assert!(!rl.allow(a).await);
    assert!(rl.allow(b).await);
}

#[tokio::test]
async fn rate_limiter_allow_window_resets_after_elapsed() {
    let rl = RateLimiter::with_policy(Duration::from_millis(10), 1);
    let ip: IpAddr = "127.0.0.1".parse().unwrap();
    assert!(rl.allow(ip).await);
    assert!(!rl.allow(ip).await);
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(rl.allow(ip).await);
}

#[tokio::test]
async fn rate_limit_paths_limits_matching_prefix_and_passes_others() {
    // Mirrors the `main.rs` RPC wiring: `rate_limit_paths` mounted with
    // the search-palette prefix. Drives the route via `oneshot` to assert
    // both the over-limit (429) and the pass-through (non-matching path)
    // cases. `oneshot` carries no `ConnectInfo`, so every request shares
    // the `0.0.0.0` fallback bucket — exactly one budget under test.
    use axum::middleware::from_fn_with_state;
    use axum::{body::Body, routing::get, Router};
    use tower::ServiceExt;

    let max = 3u32;
    let limiter = Arc::new(RateLimiter::with_policy(Duration::from_secs(60), max));
    let prefixes: Arc<Vec<&'static str>> = Arc::new(vec!["/api/rpc/search-palette"]);
    let app = Router::new()
        .route("/api/rpc/search-palette", get(|| async { "ok" }))
        .route("/api/rpc/other", get(|| async { "ok" }))
        .layer(from_fn_with_state((limiter, prefixes), rate_limit_paths));

    let palette_req = || {
        Request::builder()
            .uri("/api/rpc/search-palette?q=hello")
            .body(Body::empty())
            .unwrap()
    };

    // Matching prefix: first `max` requests pass, the next trips the limiter.
    for i in 0..max {
        let res = app.clone().oneshot(palette_req()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "request #{i} within budget");
    }
    let over = app.clone().oneshot(palette_req()).await.unwrap();
    assert_eq!(over.status(), StatusCode::TOO_MANY_REQUESTS);

    // Non-matching `/api/rpc/*` path bypasses the limiter entirely: it still
    // returns 200 even though the shared bucket is already over budget,
    // proving the prefix filter short-circuits before `allow()`.
    for _ in 0..(max + 5) {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/rpc/other")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "non-matching /api/rpc/* path must bypass the limiter"
        );
    }
}

#[tokio::test]
async fn one_shared_limiter_unifies_rest_and_rpc_search_budget() {
    // #249: REST and RPC search layers handed the same Arc must share one
    // per-IP budget. `oneshot` has no ConnectInfo, so all share 0.0.0.0.
    use axum::middleware::from_fn_with_state;
    use axum::{body::Body, routing::get, Router};
    use tower::ServiceExt;

    let max = 4u32;
    let limiter = Arc::new(RateLimiter::with_policy(Duration::from_secs(60), max));
    // Prefix covers both /api/rpc/search and /api/rpc/search-palette.
    let rpc_prefixes: Arc<Vec<&'static str>> = Arc::new(vec!["/api/rpc/search"]);

    // REST limited by rate_limit_by_ip, RPC by rate_limit_paths — same Arc.
    let rest = Router::new()
        .route("/api/search", get(|| async { "ok" }))
        .layer(from_fn_with_state(limiter.clone(), rate_limit_by_ip));
    let app = Router::new()
        .route("/api/rpc/search", get(|| async { "ok" }))
        .route("/api/rpc/search-palette", get(|| async { "ok" }))
        .merge(rest)
        .layer(from_fn_with_state(
            (limiter.clone(), rpc_prefixes),
            rate_limit_paths,
        ));

    // Spend the entire budget on the REST family.
    for i in 0..max {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/search?q=x")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "REST request #{i} within budget"
        );
    }
    // Both RPC search routes are now exhausted too, proving one shared
    // budget — and that the full search is covered, not just the palette.
    for uri in ["/api/rpc/search?q=x", "/api/rpc/search-palette?q=x"] {
        let rpc = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            rpc.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "{uri} must be blocked once REST has spent the shared budget"
        );
    }
}

#[tokio::test]
async fn auth_limiter_throttles_login_but_not_me() {
    // Mirrors the `main.rs` auth-router wiring: a default RateLimiter
    // mounted on the auth router via `rate_limit_paths` with a prefix
    // allow-list that *excludes* `/api/auth/me`. Verifies that bursting
    // /me past the 10/60s default budget never trips the limiter, while
    // /login on the same IP still does. Guards against future regression
    // where someone re-mounts the auth router with `rate_limit_by_ip`
    // (which would re-include /me in the bucket).
    use axum::middleware::from_fn_with_state;
    use axum::{body::Body, routing::get, routing::post, Router};
    use tower::ServiceExt;

    let limiter = Arc::new(RateLimiter::new()); // default 10/60s
    let prefixes: Arc<Vec<&'static str>> = Arc::new(vec![
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/logout",
    ]);
    let app = Router::new()
        .route("/api/auth/me", get(|| async { "ok" }))
        .route("/api/auth/login", post(|| async { "ok" }))
        .layer(from_fn_with_state((limiter, prefixes), rate_limit_paths));

    // Burst /me far past the 10/60s budget — every request must pass.
    for i in 0..(MAX_REQUESTS as usize * 3) {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/auth/me")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "/api/auth/me must bypass the auth limiter (request #{i})"
        );
    }

    // /login on the same shared bucket (oneshot has no ConnectInfo so
    // everything resolves to the 0.0.0.0 fallback) must still throttle
    // after MAX_REQUESTS hits. The /me burst above did NOT consume from
    // the bucket, so the first MAX_REQUESTS logins all succeed.
    for i in 0..MAX_REQUESTS {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/auth/login")
                    .method("POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "/api/auth/login within budget (request #{i})"
        );
    }
    let over = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/login")
                .method("POST")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        over.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "/api/auth/login must still be limited"
    );
}

#[tokio::test]
async fn rate_limiter_allow_prunes_stale_entries_at_cap() {
    let rl = RateLimiter::with_policy(Duration::from_millis(1), MAX_REQUESTS);
    // Fill to just under the cap using distinct IPs.
    for i in 0..MAX_BUCKETS {
        let ip = IpAddr::V4(std::net::Ipv4Addr::from(i as u32));
        rl.allow(ip).await;
    }
    // All windows are stale; a new allow() call should prune and succeed.
    tokio::time::sleep(Duration::from_millis(10)).await;
    let ip: IpAddr = "1.2.3.4".parse().unwrap();
    assert!(rl.allow(ip).await);
    assert!(rl.inner.lock().await.len() < MAX_BUCKETS);
}

#[tokio::test]
async fn registration_status_bypasses_the_auth_limiter() {
    // `/api/auth/registration` is hit on every login/register page mount, so
    // it must stay out of the brute-force bucket for the same reason
    // `/api/auth/me` was taken out of it: parallel Playwright workers and
    // ordinary navigation share one loopback IP and would 429.
    //
    // Today it escapes only because `starts_with("/api/auth/register")` is
    // false for "registration" ("registr-ation" diverges from "regist-er" at
    // the 7th character). That is a spelling accident, not a decision — this
    // test is what turns it into one. Broadening the prefix (e.g. to
    // "/api/auth/regist") must fail here rather than silently throttling page
    // loads in production.
    use axum::middleware::from_fn_with_state;
    use axum::{body::Body, routing::get, Router};
    use tower::ServiceExt;

    let limiter = Arc::new(RateLimiter::new()); // default 10/60s
    let prefixes: Arc<Vec<&'static str>> = Arc::new(vec![
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/logout",
    ]);
    let app = Router::new()
        .route("/api/auth/registration", get(|| async { "ok" }))
        .layer(from_fn_with_state((limiter, prefixes), rate_limit_paths));

    for i in 0..(MAX_REQUESTS as usize * 3) {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/auth/registration")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "/api/auth/registration must bypass the auth limiter (request #{i})"
        );
    }
}

// ------------------------------------------------- client_ip resolution

/// Build a request extension set carrying `ip` as the TCP peer.
fn peer(ip: &str) -> http::Extensions {
    let mut ext = http::Extensions::new();
    ext.insert(ConnectInfo(SocketAddr::new(ip.parse().unwrap(), 51234)));
    ext
}

fn forwarded(value: &str) -> http::HeaderMap {
    let mut headers = http::HeaderMap::new();
    headers.insert("x-forwarded-for", value.parse().unwrap());
    headers
}

fn ip(s: &str) -> IpAddr {
    s.parse().unwrap()
}

#[tokio::test]
async fn client_ip_uses_the_peer_and_ignores_forwarding_when_not_trusted() {
    let _env = EnvVarGuard::set("OMNIBUS_TRUST_FORWARDED_FOR", None);
    assert_eq!(
        client_ip(&peer("198.51.100.7"), &forwarded("203.0.113.9")),
        ip("198.51.100.7")
    );
}

/// AC3: with the opt-in on, the *rightmost* hop wins — the one the trusted
/// proxy appended. Everything to its left is whatever the client chose to
/// send, so a prepended hop must not select a bucket. This also covers the
/// forwarded hop outranking the TCP peer: behind a proxy that peer *is* the
/// proxy (`10.0.0.1` here), so the forwarded hop has to win or the whole
/// internet would share one bucket even with the opt-in on.
#[tokio::test]
async fn client_ip_ignores_a_client_supplied_leading_forwarded_hop() {
    let _env = EnvVarGuard::set("OMNIBUS_TRUST_FORWARDED_FOR", Some("1"));
    assert_eq!(
        client_ip(&peer("10.0.0.1"), &forwarded("1.2.3.4, 203.0.113.9")),
        ip("203.0.113.9"),
        "the leftmost hop is attacker-controlled and must not pick the bucket"
    );
}

/// A proxy that appends its own header line rather than extending the
/// existing one still only vouches for the last hop of the last line.
#[tokio::test]
async fn client_ip_reads_the_last_forwarded_header_line() {
    let _env = EnvVarGuard::set("OMNIBUS_TRUST_FORWARDED_FOR", Some("1"));
    let mut headers = http::HeaderMap::new();
    headers.append("x-forwarded-for", "1.2.3.4".parse().unwrap());
    headers.append("x-forwarded-for", "203.0.113.9".parse().unwrap());
    assert_eq!(client_ip(&peer("10.0.0.1"), &headers), ip("203.0.113.9"));
}

/// Trust on but no header (a direct hit that bypassed the proxy, or a
/// health check) still resolves to the peer rather than the sentinel.
#[tokio::test]
async fn client_ip_falls_back_to_the_peer_when_no_forwarded_header_is_present() {
    let _env = EnvVarGuard::set("OMNIBUS_TRUST_FORWARDED_FOR", Some("1"));
    assert_eq!(
        client_ip(&peer("198.51.100.7"), &http::HeaderMap::new()),
        ip("198.51.100.7")
    );
    // An unparsable hop is no hop at all.
    assert_eq!(
        client_ip(&peer("198.51.100.7"), &forwarded("not-an-ip")),
        ip("198.51.100.7")
    );
}

/// No peer at all (a `oneshot`, or a dioxus bump that stops handing us a
/// make-service with connect info) falls back to the process-wide sentinel.
#[tokio::test]
async fn client_ip_falls_back_to_the_sentinel_when_no_peer_is_available() {
    let _env = EnvVarGuard::set("OMNIBUS_TRUST_FORWARDED_FOR", None);
    assert_eq!(
        client_ip(&http::Extensions::new(), &http::HeaderMap::new()),
        IpAddr::V4(Ipv4Addr::UNSPECIFIED)
    );
}

/// AC1/AC2: two requests carrying different `ConnectInfo` addresses get
/// different buckets, and exhausting one leaves the other's budget intact.
#[tokio::test]
async fn rate_limit_by_ip_gives_each_connect_info_address_its_own_bucket() {
    use axum::middleware::from_fn_with_state;
    use axum::{body::Body, routing::post, Router};
    use tower::ServiceExt;

    let _env = EnvVarGuard::set("OMNIBUS_TRUST_FORWARDED_FOR", None);
    let max = 2u32;
    let limiter = Arc::new(RateLimiter::with_policy(Duration::from_secs(60), max));
    let app = Router::new()
        .route("/api/auth/login", post(|| async { "ok" }))
        .layer(from_fn_with_state(limiter, rate_limit_by_ip));

    let login_from = |addr: &str| {
        let mut req = Request::builder()
            .uri("/api/auth/login")
            .method("POST")
            .body(Body::empty())
            .unwrap();
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::new(addr.parse().unwrap(), 51234)));
        req
    };

    for i in 0..max {
        let res = app
            .clone()
            .oneshot(login_from("198.51.100.7"))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "request #{i} within budget");
    }
    let over = app
        .clone()
        .oneshot(login_from("198.51.100.7"))
        .await
        .unwrap();
    assert_eq!(over.status(), StatusCode::TOO_MANY_REQUESTS);

    let other = app.oneshot(login_from("198.51.100.8")).await.unwrap();
    assert_eq!(
        other.status(),
        StatusCode::OK,
        "one address exhausting its budget must not lock out another"
    );
}
