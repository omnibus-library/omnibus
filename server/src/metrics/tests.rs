//! Tests for the Prometheus scrape endpoint: the `OMNIBUS_METRICS_TOKEN`
//! bearer gate (404 unset / 401 wrong / 200 right), the grouping of
//! id-bearing paths by matched route, the single collapsed label every
//! unmatched path shares, and the constant-time token compare.

use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
    routing::get,
};
use omnibus_db::test_support::EnvVarGuard;
use tower::ServiceExt;
use tracing_subscriber::prelude::*;

use crate::request_log::tests::Sink;

const TOKEN: &str = "scrape-token-for-tests";

/// A `GET /metrics` carrying `Authorization: Bearer <token>`, or none when
/// `token` is `None`.
fn scrape(token: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().uri("/metrics");
    if let Some(t) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    builder.body(Body::empty()).unwrap()
}

async fn body_text(res: axum::response::Response) -> String {
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    String::from_utf8(bytes.to_vec()).expect("exposition text is utf8")
}

/// One test drives the exposition-shape and id-grouping assertions.
/// `layer_and_route` memoizes its (layer, route) so repeat calls are safe, but
/// keeping the *count* assertions in a single test that owns
/// `/api/ebooks/{uuid}` keeps them free of bleed through the shared global
/// recorder under plain `cargo test`.
#[tokio::test]
async fn metrics_endpoint_renders_labeled_histograms_and_groups_id_paths() {
    let _env = EnvVarGuard::set("OMNIBUS_METRICS_TOKEN", Some(TOKEN));
    let (layer, metrics_route) = layer_and_route();
    let app: Router = Router::new()
        .route("/api/ebooks/{uuid}", get(|| async { "ok" }))
        .merge(metrics_route)
        .layer(layer);

    for id in ["42", "999"] {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/ebooks/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
    }

    let res = app.oneshot(scrape(Some(TOKEN))).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let text = body_text(res).await;

    assert!(
        text.contains("axum_http_requests_total"),
        "expected the request counter family, got:\n{text}",
    );
    assert!(
        text.contains("axum_http_requests_duration_seconds"),
        "expected the latency histogram family, got:\n{text}",
    );

    let total = text
        .lines()
        .find(|l| {
            l.starts_with("axum_http_requests_total")
                && l.contains(r#"endpoint="/api/ebooks/{uuid}""#)
        })
        .expect("a total series for the grouped ebooks route");
    assert!(total.contains(r#"method="GET""#), "method label: {total}");
    assert!(total.contains(r#"status="200""#), "status label: {total}");
    assert!(
        total.trim_end().ends_with(" 2"),
        "expected two requests recorded on the grouped series, got: {total}",
    );
    assert!(
        !text.contains("/api/ebooks/42") && !text.contains("/api/ebooks/999"),
        "raw ids must not appear as endpoint labels, got:\n{text}",
    );
}

/// AC3: a request no route matched carries no `MatchedPath`, so the default
/// label type would use the raw URI and let a crawler mint one series per
/// path it invents. Every such request collapses to one constant instead.
#[tokio::test]
async fn metrics_endpoint_collapses_every_unmatched_path_into_one_series() {
    let _env = EnvVarGuard::set("OMNIBUS_METRICS_TOKEN", Some(TOKEN));
    let (layer, metrics_route) = layer_and_route();
    let app: Router = Router::new()
        .route("/api/known", get(|| async { "ok" }))
        .merge(metrics_route)
        .layer(layer);

    for path in ["/api/UserStorage/../ebooks", "/wp-admin/setup-config.php"] {
        let res = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    let text = body_text(app.oneshot(scrape(Some(TOKEN))).await.unwrap()).await;

    let unmatched: Vec<&str> = text
        .lines()
        .filter(|l| {
            l.starts_with("axum_http_requests_total")
                && l.contains(&format!(r#"endpoint="{UNMATCHED_ENDPOINT}""#))
        })
        .collect();
    assert_eq!(
        unmatched.len(),
        1,
        "two unmatched paths must share one series, got:\n{text}"
    );
    assert!(
        !text.contains("UserStorage") && !text.contains("wp-admin"),
        "an unmatched path must never reach a label, got:\n{text}"
    );
}

/// AC1: with no token configured the endpoint does not exist. A 401 would
/// still advertise that something is there; a 404 is what an operator who
/// never wanted metrics should see.
#[tokio::test]
async fn metrics_endpoint_404s_when_no_scrape_token_is_configured() {
    let _env = EnvVarGuard::set("OMNIBUS_METRICS_TOKEN", None);
    let (layer, metrics_route) = layer_and_route();
    let app: Router = Router::new().merge(metrics_route).layer(layer);

    let res = app.oneshot(scrape(Some(TOKEN))).await.unwrap();

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

/// A blank value is not a token — treating `OMNIBUS_METRICS_TOKEN=""` as one
/// would publish the payload to anyone who sends `Authorization: Bearer `.
#[tokio::test]
async fn metrics_endpoint_404s_when_the_scrape_token_is_blank() {
    let _env = EnvVarGuard::set("OMNIBUS_METRICS_TOKEN", Some("   "));
    let (layer, metrics_route) = layer_and_route();
    let app: Router = Router::new().merge(metrics_route).layer(layer);

    let res = app.oneshot(scrape(Some(""))).await.unwrap();

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

/// AC1: a configured endpoint refuses every caller but the one holding the
/// token — no header, the wrong token, and the wrong scheme alike.
#[tokio::test]
async fn metrics_endpoint_401s_without_the_configured_bearer_token() {
    let _env = EnvVarGuard::set("OMNIBUS_METRICS_TOKEN", Some(TOKEN));
    let (layer, metrics_route) = layer_and_route();
    let app: Router = Router::new().merge(metrics_route).layer(layer);

    for token in [None, Some("wrong-token"), Some("")] {
        let res = app.clone().oneshot(scrape(token)).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::UNAUTHORIZED,
            "token={token:?} must not read the payload"
        );
    }

    let basic = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .header(header::AUTHORIZATION, format!("Basic {TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(basic.status(), StatusCode::UNAUTHORIZED);

    // AC2: the documented token still works.
    let ok = app.oneshot(scrape(Some(TOKEN))).await.unwrap();
    assert_eq!(ok.status(), StatusCode::OK);
}

#[test]
fn constant_time_eq_matches_only_identical_bytes() {
    assert!(constant_time_eq(b"abc", b"abc"));
    assert!(!constant_time_eq(b"abc", b"abd"));
    assert!(!constant_time_eq(b"abc", b"abcd"));
    assert!(!constant_time_eq(b"", b"a"));
    assert!(constant_time_eq(b"", b""));
}

#[test]
fn warn_if_disabled_logs_once_when_no_token_is_configured() {
    let _env = EnvVarGuard::set("OMNIBUS_METRICS_TOKEN", None);
    assert!(scrape_token().is_none());

    let sink = Sink::default();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_writer(sink.clone()));
    let _guard = tracing::subscriber::set_default(subscriber);

    // Each nextest test is its own process, so the `Once` inside
    // `warn_if_disabled` is fresh here; calling it twice proves the second
    // call is the no-op.
    warn_if_disabled();
    warn_if_disabled();

    let text = sink.text();
    assert_eq!(
        text.matches("OMNIBUS_METRICS_TOKEN is unset").count(),
        1,
        "got: {text}"
    );
}
