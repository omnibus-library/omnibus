//! Integration tests for `/api/account/kosync`: a reader sees whether they have a KOReader
//! progress-sync password, generates one, and the generated password verifies.

use axum::http::StatusCode;
use md5::Digest;
use omnibus_db as db;
use omnibus_shared::{KosyncPassword, KosyncStatus};
use tower::ServiceExt;

use crate::backend::test_support::*;

#[tokio::test]
async fn get_kosync_reports_unconfigured_then_configured_after_a_post() {
    let (app, _state, pool) = fixture().await;
    let (_, token) = reader(&pool, "ada").await;

    let before = app
        .clone()
        .oneshot(get_with_bearer("/api/account/kosync", &token))
        .await
        .unwrap();
    assert_eq!(before.status(), StatusCode::OK);
    assert_eq!(
        body_json::<KosyncStatus>(before).await,
        KosyncStatus { configured: false }
    );

    let posted = app
        .clone()
        .oneshot(request("POST", "/api/account/kosync", Some(&token), None))
        .await
        .unwrap();
    assert_eq!(posted.status(), StatusCode::OK);

    let after = app
        .oneshot(get_with_bearer("/api/account/kosync", &token))
        .await
        .unwrap();
    assert_eq!(
        body_json::<KosyncStatus>(after).await,
        KosyncStatus { configured: true }
    );
}

#[tokio::test]
async fn post_kosync_returns_the_callers_username_and_a_password_that_verifies() {
    let (app, _state, pool) = fixture().await;
    let (id, token) = reader(&pool, "ada").await;

    let res = app
        .oneshot(request("POST", "/api/account/kosync", Some(&token), None))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let revealed: KosyncPassword = body_json(res).await;
    assert_eq!(revealed.username, "ada");
    // KOReader sends md5(password) as its key.
    let key = format!("{:x}", md5::Md5::digest(revealed.password.as_bytes()));
    assert_eq!(
        db::kosync::verify_kosync_key(&pool, "ada", &key)
            .await
            .unwrap(),
        Some(id)
    );
}

#[tokio::test]
async fn kosync_routes_return_401_without_a_session() {
    let (app, _state, _pool) = fixture().await;

    for (method, uri) in [
        ("GET", "/api/account/kosync"),
        ("POST", "/api/account/kosync"),
    ] {
        let res = app
            .clone()
            .oneshot(request(method, uri, None, None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{method}");
    }
}

fn caller() -> crate::auth::AuthUser {
    crate::auth::AuthUser {
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
        session_kind: db::auth::SessionKind::Bearer,
    }
}

#[tokio::test]
async fn get_kosync_returns_500_when_the_db_is_unavailable() {
    let (_app, state, pool) = fixture().await;
    pool.close().await;

    let res = super::get_kosync(caller(), axum::extract::State(state)).await;

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn post_kosync_returns_500_when_the_db_is_unavailable() {
    let (_app, state, pool) = fixture().await;
    pool.close().await;

    let res = super::post_kosync(caller(), axum::extract::State(state)).await;

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
