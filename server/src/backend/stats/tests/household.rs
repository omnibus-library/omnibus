//! `GET /api/users`, and `user_id` on `GET /api/stats` / `GET
//! /api/stats/sessions` (AC1–AC4). No handler-specific 500 test for
//! `/api/users`: it only reads `users` / `user_avatars`, which the auth
//! extractor reads first, so a handler-only DB failure is unreachable over
//! HTTP — the db-layer closed-pool test covers that propagation.

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use omnibus_shared::HouseholdReader;
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

#[tokio::test]
async fn api_get_users_requires_auth() {
    let (app, _state, _pool) = fixture().await;
    let res = app
        .oneshot(
            Request::builder()
                .uri("/api/users")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_users_lists_the_caller_first_then_sharers_by_name() {
    let (app, _state, pool) = fixture().await;
    let caller = auth_test_support::create_user(&pool, "caller").await;
    let token = auth_test_support::bearer_token(&pool, caller.id).await;
    auth_test_support::create_user(&pool, "alice").await;
    let dave = auth_test_support::create_user(&pool, "dave").await;
    omnibus_db::auth::set_share_stats(&pool, dave.id, false)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer("/api/users", &token))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();

    // The first element's raw keys, decoded independently of the typed
    // struct, pin the wire shape for iOS/MCP.
    let raw: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
    let mut keys: Vec<&str> = raw[0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(keys, vec!["has_avatar", "id", "is_you", "name"]);

    let readers: Vec<HouseholdReader> = serde_json::from_slice(&bytes).unwrap();
    let names: Vec<&str> = readers.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["caller", "alice"]);
    assert!(readers[0].is_you);
}
