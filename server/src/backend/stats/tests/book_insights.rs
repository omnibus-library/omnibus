//! `GET /api/books/{uuid}/insights`: auth, the unknown book's 404, the `null` of a book
//! with no sitting, the aggregate for one with sessions, per-user isolation, an unreadable
//! offset, and the DB-failure path.

use axum::{body::to_bytes, http::StatusCode};
use omnibus_shared::BookInsights;
use tower::ServiceExt;

use super::{now_secs, seed_reading_session};
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

#[tokio::test]
async fn api_get_book_insights_requires_auth() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;

    let res = app
        .oneshot(get_anon(&format!("/api/books/{uuid}/insights")))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_book_insights_returns_404_for_an_unknown_book() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(get_with_bearer("/api/books/no-such-book/insights", &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_get_book_insights_returns_null_for_a_book_with_no_sessions() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/insights"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], b"null");
}

#[tokio::test]
async fn api_get_book_insights_returns_the_aggregate_for_a_book_with_sessions() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let (_, other) = seed_book_with_uuid(&pool, "/lib", "Book B").await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    // UTC-midnight anchored so the two sessions always land on two days at offset 0.
    let t0 = (now_secs() / 86_400 - 3) * 86_400 + 3_600;
    seed_reading_session(&pool, user.id, &uuid, t0, 600).await;
    seed_reading_session(&pool, user.id, &uuid, t0 + 86_400, 900).await;
    seed_reading_session(&pool, user.id, &other, t0, 1_200).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/insights?utc_offset_minutes=0"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let insights: BookInsights = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(insights.started_at, t0);
    assert_eq!(insights.sessions, 2);
    assert_eq!(insights.seconds_total, 1_500);
    assert_eq!(insights.longest_seconds, 900);
    assert_eq!(insights.longest_started_at, t0 + 86_400);
    assert_eq!(insights.daily.len(), 2);
}

#[tokio::test]
async fn api_get_book_insights_never_serves_another_users_sessions() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let alice = auth_test_support::create_user(&pool, "alice").await;
    let bob = auth_test_support::create_user(&pool, "bob").await;
    let bob_token = auth_test_support::bearer_token(&pool, bob.id).await;
    seed_reading_session(&pool, alice.id, &uuid, now_secs() - 10_000, 600).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/insights"),
            &bob_token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], b"null");
}

/// The offset is an optional hint, so one the server can't read means what an absent one
/// does rather than costing the reader the card.
#[tokio::test]
async fn api_get_book_insights_ignores_an_unreadable_offset() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    seed_reading_session(&pool, user.id, &uuid, now_secs() - 10_000, 600).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/insights?utc_offset_minutes=abc"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let insights: BookInsights = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(insights.sessions, 1);
}

#[tokio::test]
async fn api_get_book_insights_returns_500_when_db_fails() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
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
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/insights"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
