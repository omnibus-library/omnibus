//! `GET /api/books/{uuid}/household`: auth, the unknown book's 404, a sharing reader's
//! time with the raw wire keys, a reader who doesn't share, a book only the caller has
//! opened, and the DB-failure path.

use axum::{body::to_bytes, http::StatusCode};
use omnibus_shared::BookHouseholdReader;
use tower::ServiceExt;

use super::{now_secs, seed_reading_session};
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

#[tokio::test]
async fn api_get_book_household_requires_auth() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;

    let res = app
        .oneshot(get_anon(&format!("/api/books/{uuid}/household")))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_book_household_returns_404_for_an_unknown_book() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(get_with_bearer("/api/books/no-such-book/household", &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_get_book_household_lists_a_sharing_reader_with_their_time_sessions_and_last_session() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let caller = auth_test_support::create_user(&pool, "caller").await;
    let token = auth_test_support::bearer_token(&pool, caller.id).await;
    let maya = auth_test_support::create_user(&pool, "maya").await;
    let t0 = now_secs() - 400_000;
    seed_reading_session(&pool, maya.id, &uuid, t0, 600).await;
    seed_reading_session(&pool, maya.id, &uuid, t0 + 86_400, 900).await;
    seed_reading_session(&pool, caller.id, &uuid, t0, 1_200).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/household"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    // The raw keys, decoded independently of the typed struct, pin the wire shape for clients.
    let raw: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
    let mut keys: Vec<&str> = raw[0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(
        keys,
        vec![
            "has_avatar",
            "id",
            "last_session_at",
            "name",
            "seconds",
            "sessions"
        ]
    );
    let readers: Vec<BookHouseholdReader> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(readers.len(), 1);
    assert_eq!(readers[0].id, maya.id);
    assert_eq!(readers[0].name, "maya");
    assert_eq!(readers[0].seconds, 1_500);
    assert_eq!(readers[0].sessions, 2);
    assert_eq!(readers[0].last_session_at, t0 + 86_400 + 900);
}

#[tokio::test]
async fn api_get_book_household_leaves_out_a_reader_who_does_not_share() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let caller = auth_test_support::create_user(&pool, "caller").await;
    let token = auth_test_support::bearer_token(&pool, caller.id).await;
    let dave = auth_test_support::create_user(&pool, "dave").await;
    omnibus_db::auth::set_share_stats(&pool, dave.id, false)
        .await
        .unwrap();
    seed_reading_session(&pool, dave.id, &uuid, now_secs() - 10_000, 600).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/household"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], b"[]");
}

#[tokio::test]
async fn api_get_book_household_is_empty_when_only_the_caller_has_opened_the_book() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let caller = auth_test_support::create_user(&pool, "caller").await;
    let token = auth_test_support::bearer_token(&pool, caller.id).await;
    seed_reading_session(&pool, caller.id, &uuid, now_secs() - 10_000, 600).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/household"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], b"[]");
}

#[tokio::test]
async fn api_get_book_household_returns_500_when_db_fails() {
    let (app, _state, pool) = fixture().await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    let caller = auth_test_support::create_user(&pool, "caller").await;
    let token = auth_test_support::bearer_token(&pool, caller.id).await;
    // A sharing reader, or there is no per-reader read to fail.
    auth_test_support::create_user(&pool, "alice").await;

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
            &format!("/api/books/{uuid}/household"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
