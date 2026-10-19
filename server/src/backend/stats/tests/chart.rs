//! `POST /api/stats/chart`: auth, a spec's series bucketed on the caller's offset, an
//! unreadable offset accepted, a rejected spec's 422, and the DB-failure path.

use axum::{
    body::{to_bytes, Body},
    http::{header::AUTHORIZATION, Request, StatusCode},
};
use omnibus_shared::{ChartBucket, ChartResult, ChartUnit};
use tower::ServiceExt;

use super::seed_reading_session;
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

fn post_chart_req(uri: &str, token: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .method("POST")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn reading_minutes_by_month() -> serde_json::Value {
    serde_json::json!({ "measures": ["reading_minutes"], "bucket": "month", "range": "all_time" })
}

async fn chart_body(res: axum::response::Response) -> ChartResult {
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// The first series' value in `bucket`, which the test seeded and so must exist.
fn value_in(chart: &ChartResult, bucket: &str) -> Option<f64> {
    let at = chart.buckets.iter().position(|b| b == bucket).unwrap();
    chart.series[0].values[at]
}

#[tokio::test]
async fn api_post_stats_chart_requires_auth() {
    let (app, _state, _pool) = fixture().await;
    let res = app
        .oneshot(
            Request::builder()
                .uri("/api/stats/chart")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(reading_minutes_by_month().to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_post_stats_chart_returns_the_series_for_a_valid_spec() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    // 2026-01-15 12:00 UTC, thirty minutes.
    seed_reading_session(&pool, user.id, "book-a", 1_768_478_400, 1_800).await;

    let res = app
        .oneshot(post_chart_req(
            "/api/stats/chart",
            &token,
            reading_minutes_by_month(),
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let chart = chart_body(res).await;
    assert_eq!(chart.bucket, ChartBucket::Month);
    assert_eq!(value_in(&chart, "2026-01"), Some(30.0));
    assert_eq!(chart.axes[0].unit, ChartUnit::Minutes);
}

/// Rule 10: the session records no offset, so only the declared one can move it into
/// February; without one the day is cut on UTC.
#[tokio::test]
async fn api_post_stats_chart_buckets_on_the_declared_offset() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    // 2026-01-31 23:30 UTC, twenty minutes.
    seed_reading_session(&pool, user.id, "book-a", 1_769_902_200, 1_200).await;

    let shifted = app
        .clone()
        .oneshot(post_chart_req(
            "/api/stats/chart?utc_offset_minutes=120",
            &token,
            reading_minutes_by_month(),
        ))
        .await
        .unwrap();
    assert_eq!(value_in(&chart_body(shifted).await, "2026-02"), Some(20.0));

    let utc = app
        .oneshot(post_chart_req(
            "/api/stats/chart",
            &token,
            reading_minutes_by_month(),
        ))
        .await
        .unwrap();
    assert_eq!(value_in(&chart_body(utc).await, "2026-01"), Some(20.0));
}

/// The offset is an optional hint, so one the server can't read means what an absent one
/// does rather than costing the reader the chart.
#[tokio::test]
async fn api_post_stats_chart_ignores_an_unreadable_offset() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(post_chart_req(
            "/api/stats/chart?utc_offset_minutes=abc",
            &token,
            reading_minutes_by_month(),
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn api_post_stats_chart_returns_422_with_the_reason_for_a_rejected_spec() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(post_chart_req(
            "/api/stats/chart",
            &token,
            serde_json::json!({
                "measures": ["reading_minutes", "reading_minutes"],
                "bucket": "month",
                "range": "all_time",
            }),
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body_text(res).await,
        "Reading minutes is already on this chart"
    );
}

#[tokio::test]
async fn api_post_stats_chart_returns_500_when_db_fails() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query("DROP TABLE reading_sessions")
        .execute(&mut *conn)
        .await
        .unwrap();
    drop(conn);

    let res = app
        .oneshot(post_chart_req(
            "/api/stats/chart",
            &token,
            reading_minutes_by_month(),
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
