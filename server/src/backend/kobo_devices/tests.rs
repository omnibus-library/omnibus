//! Integration tests for the Kobo device REST routes: each reader sees and changes only
//! their own devices, a regenerated token replaces the old one at the Kobo sync
//! address, and a missing or foreign id answers 404.

use axum::{
    body::{to_bytes, Body},
    http::{header::AUTHORIZATION, Request, StatusCode},
};
use omnibus_db::auth::SessionKind;
use tower::ServiceExt;

use super::*;
use crate::auth::test_support as auth_test_support;
use crate::backend::kobo::kobo_router;
use crate::backend::test_support::*;

fn fake_reader(id: i64) -> AuthUser {
    AuthUser {
        id,
        username: "reader".to_string(),
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
    }
}

fn request(method: &str, uri: &str, token: &str, body: Option<serde_json::Value>) -> Request<Body> {
    let builder = Request::builder()
        .uri(uri)
        .method(method)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    match body {
        Some(json) => builder
            .header("content-type", "application/json")
            .body(Body::from(json.to_string())),
        None => builder.body(Body::empty()),
    }
    .unwrap()
}

async fn json_of<T: serde::de::DeserializeOwned>(res: Response) -> T {
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// A reader with a bearer token and one registered Kobo.
async fn reader_with_device(
    pool: &sqlx::SqlitePool,
    username: &str,
) -> (String, db::kobo_devices::KoboDevice) {
    let user = auth_test_support::create_user(pool, username).await;
    let token = auth_test_support::bearer_token(pool, user.id).await;
    let device = db::kobo_devices::create_device(pool, user.id, "Clara")
        .await
        .unwrap();
    (token, device)
}

#[tokio::test]
async fn list_kobo_devices_returns_only_the_callers_devices() {
    let (app, _state, pool) = fixture().await;
    let (token, mine) = reader_with_device(&pool, "ada").await;
    reader_with_device(&pool, "grace").await;

    let res = app
        .oneshot(request("GET", "/api/account/kobo-devices", &token, None))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let devices: Vec<KoboDeviceView> = json_of(res).await;
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].id, mine.id);
    assert_eq!(devices[0].token, mine.token);
}

#[tokio::test]
async fn list_kobo_devices_returns_401_when_anonymous() {
    let (app, _state, _pool) = fixture().await;

    let res = app
        .oneshot(get_anon("/api/account/kobo-devices"))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

// Called directly: closing the pool first would fail the `AuthUser` extractor's own
// session lookup rather than the handler body under test.
#[tokio::test]
async fn list_kobo_devices_returns_500_when_pool_closed() {
    let (_app, state, pool) = fixture().await;
    pool.close().await;

    let res = list_kobo_devices(fake_reader(1), State(state)).await;

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn create_kobo_device_returns_the_trimmed_device_with_a_token() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "ada").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(request(
            "POST",
            "/api/account/kobo-devices",
            &token,
            Some(serde_json::json!({ "name": "  Libra  " })),
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let device: KoboDeviceView = json_of(res).await;
    assert_eq!(device.name, "Libra");
    assert!(!device.token.is_empty());
    let stored = db::kobo_devices::list_devices(&pool, user.id)
        .await
        .unwrap();
    assert_eq!(stored[0].token, device.token);
}

#[tokio::test]
async fn create_kobo_device_returns_422_when_the_name_is_blank() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "ada").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(request(
            "POST",
            "/api/account/kobo-devices",
            &token,
            Some(serde_json::json!({ "name": "   " })),
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body_text(res).await,
        "enter a device name (1–100 characters)"
    );
}

#[tokio::test]
async fn regenerate_kobo_device_replaces_the_token_at_the_sync_address() {
    let (app, state, pool) = fixture().await;
    let (token, device) = reader_with_device(&pool, "ada").await;
    let sync = kobo_router(state);
    let init = |t: &str| get_anon(&format!("/kobo/{t}/v1/initialization"));
    assert_eq!(
        sync.clone()
            .oneshot(init(&device.token))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );

    let res = app
        .oneshot(request(
            "POST",
            &format!("/api/account/kobo-devices/{}/regenerate", device.id),
            &token,
            None,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let renewed: KoboDeviceView = json_of(res).await;
    assert_ne!(renewed.token, device.token);
    assert_eq!(renewed.name, "Clara");
    assert_eq!(
        sync.clone()
            .oneshot(init(&device.token))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        sync.oneshot(init(&renewed.token)).await.unwrap().status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn regenerate_kobo_device_returns_404_for_another_readers_or_unknown_device() {
    let (app, _state, pool) = fixture().await;
    let (token, _mine) = reader_with_device(&pool, "ada").await;
    let (_other_token, theirs) = reader_with_device(&pool, "grace").await;

    for id in [theirs.id, 9999] {
        let res = app
            .clone()
            .oneshot(request(
                "POST",
                &format!("/api/account/kobo-devices/{id}/regenerate"),
                &token,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        assert_eq!(body_text(res).await, "kobo device not found");
    }
    let untouched = db::kobo_devices::get_device_for_user(&pool, theirs.user_id, theirs.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(untouched.token, theirs.token);
}

#[tokio::test]
async fn delete_kobo_device_removes_it_from_the_list() {
    let (app, _state, pool) = fixture().await;
    let (token, device) = reader_with_device(&pool, "ada").await;

    let res = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/account/kobo-devices/{}", device.id),
            &token,
            None,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let list = app
        .oneshot(request("GET", "/api/account/kobo-devices", &token, None))
        .await
        .unwrap();
    assert!(json_of::<Vec<KoboDeviceView>>(list).await.is_empty());
}

#[tokio::test]
async fn delete_kobo_device_returns_404_for_another_readers_or_unknown_device() {
    let (app, _state, pool) = fixture().await;
    let (token, _mine) = reader_with_device(&pool, "ada").await;
    let (_other_token, theirs) = reader_with_device(&pool, "grace").await;

    for id in [theirs.id, 9999] {
        let res = app
            .clone()
            .oneshot(request(
                "DELETE",
                &format!("/api/account/kobo-devices/{id}"),
                &token,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        assert_eq!(body_text(res).await, "kobo device not found");
    }
    let remaining = db::kobo_devices::list_devices(&pool, theirs.user_id)
        .await
        .unwrap();
    assert_eq!(remaining.len(), 1);
}
