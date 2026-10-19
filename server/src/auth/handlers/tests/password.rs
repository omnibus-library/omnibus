//! `POST /api/auth/password`: a session changes its own password, the new one signs in
//! and the old one does not, every other session is signed out while the caller's
//! survives, and a wrong current password, a weak new one, an API-token caller and an
//! anonymous one are each refused.

use axum::{
    body::Body,
    http::{header, Request},
};
use omnibus_db as db;
use omnibus_shared::ChangePasswordRequest;
use serde_json::json;
use tower::ServiceExt;

use super::super::*;
use super::{app, json_req};
use crate::auth::test_support::{bearer_token, create_user_with_password};

const OLD: &str = "correct horse battery 1";
const NEW: &str = "a brand new passphrase 2";

fn change_req(token: Option<&str>, current: &str, new: &str) -> Request<Body> {
    let builder = Request::builder()
        .uri("/api/auth/password")
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json");
    let builder = match token {
        Some(token) => builder.header(header::AUTHORIZATION, format!("Bearer {token}")),
        None => builder,
    };
    builder
        .body(Body::from(
            json!({ "current_password": current, "new_password": new }).to_string(),
        ))
        .unwrap()
}

fn me_req(token: &str) -> Request<Body> {
    Request::builder()
        .uri("/api/auth/me")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

async fn login_status(app: &Router, password: &str) -> StatusCode {
    app.clone()
        .oneshot(json_req(
            "/api/auth/login",
            "POST",
            json!({ "username": "alice", "password": password }),
        ))
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn change_password_handler_switches_the_password_when_current_one_is_right() {
    let (app, pool) = app().await;
    let user = create_user_with_password(&pool, "alice", OLD).await;
    let token = bearer_token(&pool, user.id).await;

    let res = app
        .clone()
        .oneshot(change_req(Some(&token), OLD, NEW))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert_eq!(login_status(&app, NEW).await, StatusCode::OK);
    assert_eq!(login_status(&app, OLD).await, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn change_password_handler_signs_out_other_sessions_and_keeps_the_callers() {
    let (app, pool) = app().await;
    let user = create_user_with_password(&pool, "alice", OLD).await;
    let caller = bearer_token(&pool, user.id).await;
    let other = bearer_token(&pool, user.id).await;

    app.clone()
        .oneshot(change_req(Some(&caller), OLD, NEW))
        .await
        .unwrap();

    let kept = app.clone().oneshot(me_req(&caller)).await.unwrap();
    let dropped = app.oneshot(me_req(&other)).await.unwrap();
    assert_eq!(kept.status(), StatusCode::OK);
    assert_eq!(dropped.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn change_password_handler_returns_403_when_current_password_is_wrong() {
    let (app, pool) = app().await;
    let user = create_user_with_password(&pool, "alice", OLD).await;
    let token = bearer_token(&pool, user.id).await;

    let res = app
        .clone()
        .oneshot(change_req(Some(&token), "not my password", NEW))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&body[..], b"current password is incorrect");
    assert_eq!(login_status(&app, OLD).await, StatusCode::OK);
}

#[tokio::test]
async fn change_password_handler_returns_400_when_new_password_fails_policy() {
    let (app, pool) = app().await;
    let user = create_user_with_password(&pool, "alice", OLD).await;
    let token = bearer_token(&pool, user.id).await;

    let res = app
        .clone()
        .oneshot(change_req(Some(&token), OLD, "short"))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(login_status(&app, OLD).await, StatusCode::OK);
}

#[tokio::test]
async fn change_password_handler_returns_403_for_an_api_token() {
    let (app, pool) = app().await;
    let user = create_user_with_password(&pool, "alice", OLD).await;
    let minted = db::auth::create_api_token(&pool, user.id, "mcp")
        .await
        .unwrap();

    let res = app
        .clone()
        .oneshot(change_req(Some(&minted.raw_token), OLD, NEW))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&body[..], b"sign in with your password to change it");
    assert_eq!(login_status(&app, OLD).await, StatusCode::OK);
}

#[tokio::test]
async fn change_password_handler_returns_401_when_anonymous() {
    let (app, _pool) = app().await;

    let res = app.oneshot(change_req(None, OLD, NEW)).await.unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

// Called directly: closing the pool first would fail the `AuthUser` extractor itself.
#[tokio::test]
async fn change_password_handler_returns_500_when_pool_closed() {
    let (_app, pool) = app().await;
    pool.close().await;
    let user = AuthUser {
        id: 1,
        username: "alice".to_string(),
        is_admin: false,
        can_upload: false,
        can_edit: false,
        can_download: true,
        kindle_email: None,
        display_name: None,
        has_avatar: false,
        hidden_formats: Vec::new(),
        book_detail_scroll_stops: false,
        stack_series: false,
        share_stats: true,
        session_id: 1,
        session_kind: SessionKind::Bearer,
    };
    let body = ChangePasswordRequest {
        current_password: OLD.to_string(),
        new_password: NEW.to_string(),
    };

    let res = change_password_handler(user, State(AppState::new(pool)), Json(body)).await;

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
