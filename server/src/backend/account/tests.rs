//! Tests for the account preferences: hidden formats (set/normalize/validate
//! via `POST /api/account/hidden-formats`) and the book-detail scroll-stops,
//! Stack series, and share-stats switches. The `/api/auth/me` round trip is
//! covered in `crate::auth::handlers::tests` (the route lives on that router).

use axum::{
    body::Body,
    extract::State,
    http::{header::AUTHORIZATION, Request, StatusCode},
    Json,
};
use tower::ServiceExt;

use omnibus_db::{self as db, auth::SessionKind};

use crate::auth::test_support as auth_test_support;
use crate::auth::AuthUser;
use crate::backend::test_support::*;

use super::{post_share_stats, post_stack_series, SetShareStats, SetStackSeries};

/// Build an authenticated JSON POST request.
fn post_json(uri: &str, token: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .method("POST")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn post_hidden_formats_saves_normalized_list_for_the_caller() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "reader").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let response = app
        .oneshot(post_json(
            "/api/account/hidden-formats",
            &token,
            serde_json::json!({ "formats": ["CBZ", " m4b ", "cbz"] }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let stored = db::auth::get_hidden_formats(&pool, user.id).await.unwrap();
    assert_eq!(stored, vec!["cbz".to_string(), "m4b".to_string()]);
}

#[tokio::test]
async fn post_hidden_formats_rejects_malformed_token_with_422() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "reader").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let response = app
        .oneshot(post_json(
            "/api/account/hidden-formats",
            &token,
            serde_json::json!({ "formats": ["not a format!"] }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn post_hidden_formats_without_session_returns_401() {
    let (app, _, _) = fixture().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/account/hidden-formats")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"formats":["cbz"]}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn post_book_detail_scroll_stops_saves_the_flag_for_the_caller() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "reader").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    assert!(!db::auth::get_book_detail_scroll_stops(&pool, user.id)
        .await
        .unwrap());

    let response = app
        .oneshot(post_json(
            "/api/account/book-detail-scroll-stops",
            &token,
            serde_json::json!({ "enabled": true }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    assert!(db::auth::get_book_detail_scroll_stops(&pool, user.id)
        .await
        .unwrap());
}

#[tokio::test]
async fn post_book_detail_scroll_stops_turns_the_flag_back_off() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "reader").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    db::auth::set_book_detail_scroll_stops(&pool, user.id, true)
        .await
        .unwrap();

    let response = app
        .oneshot(post_json(
            "/api/account/book-detail-scroll-stops",
            &token,
            serde_json::json!({ "enabled": false }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    assert!(!db::auth::get_book_detail_scroll_stops(&pool, user.id)
        .await
        .unwrap());
}

#[tokio::test]
async fn post_book_detail_scroll_stops_without_session_returns_401() {
    let (app, _, _) = fixture().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/account/book-detail-scroll-stops")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"enabled":true}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn post_stack_series_saves_and_clears_the_flag_for_the_caller() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "reader").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    for enabled in [true, false] {
        let response = app
            .clone()
            .oneshot(post_json(
                "/api/account/stack-series",
                &token,
                serde_json::json!({ "enabled": enabled }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let saved = db::auth::get_user_by_id(&pool, user.id)
            .await
            .unwrap()
            .unwrap()
            .stack_series;
        assert_eq!(saved, enabled);
    }
}

#[tokio::test]
async fn post_stack_series_without_session_returns_401() {
    let (app, _, _) = fixture().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/account/stack-series")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"enabled":true}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// Invoked directly: a closed pool would fail the bearer extractor before the handler ran.
#[tokio::test]
async fn post_stack_series_returns_500_when_the_db_is_unavailable() {
    let (_app, state, pool) = fixture().await;
    pool.close().await;
    let user = AuthUser {
        id: 1,
        username: "reader".to_string(),
        is_admin: false,
        can_upload: false,
        can_edit: false,
        can_download: false,
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

    let res = post_stack_series(user, State(state), Json(SetStackSeries { enabled: true })).await;

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn post_share_stats_saves_both_directions_with_an_empty_200() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "reader").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    for enabled in [false, true] {
        let response = app
            .clone()
            .oneshot(post_json(
                "/api/account/share-stats",
                &token,
                serde_json::json!({ "enabled": enabled }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(body.is_empty());
        assert_eq!(
            db::auth::get_share_stats(&pool, user.id).await.unwrap(),
            enabled
        );
    }
}

#[tokio::test]
async fn post_share_stats_without_session_returns_401() {
    let (app, _, _) = fixture().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/account/share-stats")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"enabled":true}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn post_share_stats_rejects_a_body_without_enabled_with_422() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "reader").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let response = app
        .oneshot(post_json(
            "/api/account/share-stats",
            &token,
            serde_json::json!({}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    // The value default readers arrive with — the rejected write must not
    // have landed as a false negative.
    assert!(db::auth::get_share_stats(&pool, user.id).await.unwrap());
}

// Invoked directly: a closed pool would fail the bearer extractor before the handler ran.
#[tokio::test]
async fn post_share_stats_returns_500_when_the_db_is_unavailable() {
    let (_app, state, pool) = fixture().await;
    pool.close().await;
    let user = AuthUser {
        id: 1,
        username: "reader".to_string(),
        is_admin: false,
        can_upload: false,
        can_edit: false,
        can_download: false,
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

    let res = post_share_stats(user, State(state), Json(SetShareStats { enabled: false })).await;

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
