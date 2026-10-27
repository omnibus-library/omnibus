//! Integration tests for the Kobo device REST routes: each reader sees and changes only
//! their own devices, a regenerated token replaces the old one at the Kobo sync
//! address, and a missing or foreign id answers 404.

use axum::{
    body::{to_bytes, Body},
    http::{header::AUTHORIZATION, Request, StatusCode},
};
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::kobo::kobo_router;
use crate::backend::test_support::*;

use super::*;

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
    let device =
        db::kobo_devices::create_device(pool, user.id, "Clara", omnibus_shared::DeviceKind::Kobo)
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
        .oneshot(get_with_bearer("/api/account/kobo-devices", &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let devices: Vec<KoboDeviceView> = json_of(res).await;
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].id, mine.id);
    assert_eq!(devices[0].token, mine.token);
    assert_eq!(devices[0].kind, omnibus_shared::DeviceKind::Kobo);
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

    let res = list_kobo_devices(auth_test_support::fake_auth_user(1, 1), State(state)).await;

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

async fn create_with_body(body: serde_json::Value) -> KoboDeviceView {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "ada").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(request(
            "POST",
            "/api/account/kobo-devices",
            &token,
            Some(body),
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    json_of(res).await
}

#[tokio::test]
async fn create_kobo_device_registers_a_koreader_when_kind_is_koreader() {
    let device = create_with_body(serde_json::json!({ "name": "Libra", "kind": "koreader" })).await;

    assert_eq!(device.kind, omnibus_shared::DeviceKind::Koreader);
}

#[tokio::test]
async fn create_kobo_device_defaults_to_a_kobo_when_kind_is_omitted() {
    let device = create_with_body(serde_json::json!({ "name": "Clara" })).await;

    assert_eq!(device.kind, omnibus_shared::DeviceKind::Kobo);
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
        .oneshot(get_with_bearer("/api/account/kobo-devices", &token))
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

mod progress_sync_login {
    use axum::Router;
    use md5::Digest;
    use omnibus_shared::KosyncPassword;
    use serde_json::{json, Value};

    use super::*;
    use crate::backend::kosync_router;

    const ACCEPT: &str = "application/vnd.koreader.v1+json";

    async fn add_device(app: &Router, token: &str, kind: &str) -> Value {
        let body = json!({ "name": "Libra", "kind": kind });
        let res = app
            .clone()
            .oneshot(request(
                "POST",
                "/api/account/kobo-devices",
                token,
                Some(body),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        json_of(res).await
    }

    fn revealed(device: &Value) -> KosyncPassword {
        serde_json::from_value(device["kosync_login"].clone()).unwrap()
    }

    /// What `/kosync` answers a KOReader signing in with `login`.
    async fn kosync_sign_in(state: &AppState, login: &KosyncPassword) -> StatusCode {
        let key = format!("{:x}", md5::Md5::digest(login.password.as_bytes()));
        let req = Request::builder()
            .uri("/kosync/users/auth")
            .header("accept", ACCEPT)
            .header("x-auth-user", &login.username)
            .header("x-auth-key", key)
            .body(Body::empty())
            .unwrap();
        kosync_router(state.clone())
            .oneshot(req)
            .await
            .unwrap()
            .status()
    }

    /// The reader's Progress sync login after `register_device` added `count` no-plugin KOReaders.
    async fn reader_with_no_plugin_koreaders(
        pool: &sqlx::SqlitePool,
        name: &str,
        count: usize,
    ) -> (i64, String, KosyncPassword, Vec<i64>) {
        let (uid, token) = reader(pool, name).await;
        let mut login = None;
        let mut ids = Vec::new();
        for _ in 0..count {
            let (device, revealed) = db::kobo_devices::register_device(
                pool,
                uid,
                "Libra",
                omnibus_shared::DeviceKind::Kosync,
            )
            .await
            .unwrap();
            login = login.or(revealed);
            ids.push(device.id);
        }
        (uid, token, login.unwrap(), ids)
    }

    async fn delete_device(app: &Router, token: &str, id: i64) {
        let res = app
            .clone()
            .oneshot(request(
                "DELETE",
                &format!("/api/account/kobo-devices/{id}"),
                token,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn adding_a_no_plugin_koreader_reveals_a_login_that_signs_in() {
        let (app, state, pool) = fixture().await;
        let (_, token) = reader(&pool, "ada").await;

        let device = add_device(&app, &token, "kosync").await;

        assert_eq!(device["kind"], "kosync");
        let login = revealed(&device);
        assert_eq!(login.username, "ada");
        assert_eq!(kosync_sign_in(&state, &login).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn adding_a_second_no_plugin_koreader_shows_no_login_and_keeps_the_first() {
        let (app, state, pool) = fixture().await;
        let (_, token) = reader(&pool, "ada").await;
        let first = revealed(&add_device(&app, &token, "kosync").await);

        let second = add_device(&app, &token, "kosync").await;

        assert!(!second.as_object().unwrap().contains_key("kosync_login"));
        assert_eq!(kosync_sign_in(&state, &first).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn adding_a_no_plugin_koreader_keeps_a_password_generated_on_its_own() {
        let (app, state, pool) = fixture().await;
        let (_, token) = reader(&pool, "ada").await;
        let res = app
            .clone()
            .oneshot(request("POST", "/api/account/kosync", &token, None))
            .await
            .unwrap();
        let standalone: KosyncPassword = json_of(res).await;

        let device = add_device(&app, &token, "kosync").await;

        assert!(!device.as_object().unwrap().contains_key("kosync_login"));
        assert_eq!(kosync_sign_in(&state, &standalone).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn adding_a_kobo_or_a_plugin_koreader_shows_no_login_and_creates_none() {
        let (app, _state, pool) = fixture().await;
        let (uid, token) = reader(&pool, "ada").await;

        for kind in ["kobo", "koreader"] {
            let device = add_device(&app, &token, kind).await;
            assert!(
                !device.as_object().unwrap().contains_key("kosync_login"),
                "{kind}"
            );
        }

        assert!(!db::kosync::kosync_configured(&pool, uid).await.unwrap());
    }

    #[tokio::test]
    async fn removing_the_last_no_plugin_koreader_signs_its_login_out() {
        let (app, state, pool) = fixture().await;
        let (_, token, login, ids) = reader_with_no_plugin_koreaders(&pool, "ada", 2).await;

        delete_device(&app, &token, ids[0]).await;
        assert_eq!(kosync_sign_in(&state, &login).await, StatusCode::OK);
        delete_device(&app, &token, ids[1]).await;

        assert_eq!(
            kosync_sign_in(&state, &login).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn removing_a_kobo_or_a_plugin_koreader_keeps_a_standalone_login() {
        let (app, state, pool) = fixture().await;
        let (uid, token) = reader(&pool, "ada").await;
        let res = app
            .clone()
            .oneshot(request("POST", "/api/account/kosync", &token, None))
            .await
            .unwrap();
        let login: KosyncPassword = json_of(res).await;

        for kind in [
            omnibus_shared::DeviceKind::Kobo,
            omnibus_shared::DeviceKind::Koreader,
        ] {
            let device = db::kobo_devices::create_device(&pool, uid, "Reader", kind)
                .await
                .unwrap();
            delete_device(&app, &token, device.id).await;
        }

        assert_eq!(kosync_sign_in(&state, &login).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn another_readers_no_plugin_koreaders_do_not_keep_a_login_alive() {
        let (app, state, pool) = fixture().await;
        let (_, token, login, ids) = reader_with_no_plugin_koreaders(&pool, "ada", 1).await;
        let (_, _, theirs, _) = reader_with_no_plugin_koreaders(&pool, "grace", 1).await;

        delete_device(&app, &token, ids[0]).await;

        assert_eq!(
            kosync_sign_in(&state, &login).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(kosync_sign_in(&state, &theirs).await, StatusCode::OK);
    }
}

mod koreader_plugin {
    use super::*;

    /// A reader with a bearer token and one registered device of `kind`.
    async fn reader_with_kind(
        pool: &sqlx::SqlitePool,
        username: &str,
        kind: omnibus_shared::DeviceKind,
    ) -> (i64, String, db::kobo_devices::KoboDevice) {
        let user = auth_test_support::create_user(pool, username).await;
        let token = auth_test_support::bearer_token(pool, user.id).await;
        let device = db::kobo_devices::create_device(pool, user.id, "Reader", kind)
            .await
            .unwrap();
        (user.id, token, device)
    }

    fn plugin_request(id: i64, token: &str) -> Request<Body> {
        Request::builder()
            .uri(format!("/api/account/kobo-devices/{id}/koreader-plugin"))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header("host", "omni.test")
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn serves_the_owners_koreader_a_zip_for_this_server_and_its_token() {
        let (app, _state, pool) = fixture().await;
        let (_uid, token, device) =
            reader_with_kind(&pool, "ada", omnibus_shared::DeviceKind::Koreader).await;

        let res = app
            .oneshot(plugin_request(device.id, &token))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::OK);
        let headers = res.headers().clone();
        assert_eq!(headers["content-type"], "application/zip");
        assert_eq!(
            headers["content-disposition"],
            format!(
                "attachment; filename=\"omnibus-koreader-{}.zip\"",
                device.id
            )
        );
        assert_eq!(headers["cache-control"], "no-store");
        let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let config: serde_json::Value =
            serde_json::from_reader(archive.by_name("omnibus.koplugin/omnibus.json").unwrap())
                .unwrap();
        assert_eq!(
            config,
            serde_json::json!({ "server_url": "http://omni.test", "token": device.token })
        );
    }

    #[tokio::test]
    async fn answers_404_for_a_device_that_is_not_the_callers_koreader() {
        let (app, _state, pool) = fixture().await;
        let (uid, token, _own) =
            reader_with_kind(&pool, "ada", omnibus_shared::DeviceKind::Koreader).await;
        let own_kobo =
            db::kobo_devices::create_device(&pool, uid, "Clara", omnibus_shared::DeviceKind::Kobo)
                .await
                .unwrap();
        let no_plugin = db::kobo_devices::create_device(
            &pool,
            uid,
            "Libra",
            omnibus_shared::DeviceKind::Kosync,
        )
        .await
        .unwrap();
        let (_, _, theirs) =
            reader_with_kind(&pool, "grace", omnibus_shared::DeviceKind::Koreader).await;

        for (case, id) in [
            ("another reader's device", theirs.id),
            ("an unknown id", 9999),
            ("a Kobo of the caller's own", own_kobo.id),
            ("a no-plugin KOReader of the caller's own", no_plugin.id),
        ] {
            let res = app
                .clone()
                .oneshot(plugin_request(id, &token))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::NOT_FOUND, "{case}");
        }
    }

    #[tokio::test]
    async fn answers_401_without_a_session() {
        let (app, _state, pool) = fixture().await;
        let (_, _, device) =
            reader_with_kind(&pool, "ada", omnibus_shared::DeviceKind::Koreader).await;

        let res = app
            .oneshot(get_anon(&format!(
                "/api/account/kobo-devices/{}/koreader-plugin",
                device.id
            )))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn answers_403_when_the_reader_may_not_download() {
        let (app, _state, pool) = fixture().await;
        let (uid, token, device) =
            reader_with_kind(&pool, "ada", omnibus_shared::DeviceKind::Koreader).await;
        revoke_can_download(&pool, uid).await;

        let res = app
            .oneshot(plugin_request(device.id, &token))
            .await
            .unwrap();

        assert_eq!(res.status(), StatusCode::FORBIDDEN);
    }
}
