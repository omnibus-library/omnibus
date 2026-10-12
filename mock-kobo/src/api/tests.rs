//! The control API over real TCP: `listen`, `ready_line`, and each route's reply envelope.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::sync::Notify;

use crate::control::{Control, ControlError, DeviceView, LastSync};
use crate::device::Device;
use crate::firmware::Quirk;
use crate::state::{SavedState, StateError};
use crate::test_support::{new_entitlement, spawn_stub, stub_control, Stub, STUB_TOKEN};

use super::*;

/// A reply as the client sees it on the wire.
fn wire(reply: &Reply<Details>) -> Value {
    serde_json::to_value(reply).unwrap()
}

/// One request a healthy sync makes, as `GET /requests` lists it.
fn request(method: &str, path: &str) -> Value {
    json!({ "method": method, "path": format!("/kobo/<token>{path}"), "status": 200 })
}

/// Serve `control` on a free loopback port and return its base URL.
async fn serve(control: Arc<Control>) -> String {
    let listener = listen(0).await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let app = router(control);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    base
}

#[tokio::test]
async fn listen_binds_loopback_only() {
    let listener = listen(0).await.unwrap();

    let addr = listener.local_addr().unwrap();
    assert_eq!(addr.ip().to_string(), "127.0.0.1");
    assert_ne!(addr.port(), 0);
}

#[tokio::test]
async fn listen_fails_when_port_is_taken() {
    let held = listen(0).await.unwrap();
    let port = held.local_addr().unwrap().port();

    let result = listen(port).await;

    assert!(result.is_err());
}

#[test]
fn ready_line_names_port_hardware_id_and_state() {
    let line = ready_line(4321, "mock-ab", Path::new("x.json"));

    assert_eq!(
        line,
        "MOCK_KOBO_READY port=4321 hardware_id=mock-ab state=x.json"
    );
}

#[tokio::test]
async fn get_device_returns_ok_reply_with_device_view() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::get(format!("{base}/device")).await.unwrap();

    assert_eq!(response.status(), 200);
    let body: Value = response.json().await.unwrap();
    assert_eq!(
        body,
        json!({
            "status": 200,
            "code": "ok",
            "message": "ok",
            "details": {
                "hardware_id": "HW-1",
                "url": stub.origin,
                "syncing": false,
                "last_sync": null,
                "sync_token": null,
                "library": {},
            },
        })
    );
    assert!(!body.to_string().contains(STUB_TOKEN));
}

#[tokio::test]
async fn get_device_returns_each_book_with_its_series() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let mut entitlement = new_entitlement("book-1", "Dune");
    entitlement["NewEntitlement"]["BookMetadata"]["Series"] =
        json!({ "Name": "Dune", "Number": 1.0, "Id": "s-1" });
    let mut device = Device::new("HW-1");
    device.apply(serde_json::from_value(entitlement).unwrap());
    let saved = SavedState {
        url: None,
        token: STUB_TOKEN.into(),
        wired_url: None,
        device,
    };
    let control = Control::new(saved, stub.origin.clone(), dir.path().join("kobo.json"));
    let base = serve(Arc::new(control)).await;

    let body: Value = reqwest::get(format!("{base}/device"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(
        body["details"]["library"]["book-1"],
        json!({
            "title": "Dune",
            "description": "",
            "authors": ["Unknown"],
            "series": { "Name": "Dune", "Number": 1.0, "Id": "s-1" },
            "downloaded": false,
            "archived": false,
        })
    );
}

#[tokio::test]
async fn unknown_route_returns_not_found_reply() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::get(format!("{base}/nope")).await.unwrap();

    assert_eq!(response.status(), 404);
    let body: Value = response.json().await.unwrap();
    assert_eq!(
        body,
        json!({
            "status": 404,
            "code": "not_found",
            "message": "no route for GET /nope",
            "details": {},
        })
    );
}

#[tokio::test]
async fn wrong_method_returns_method_not_allowed_reply() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/device"))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), 405);
    let body: Value = response.json().await.unwrap();
    assert_eq!(
        body,
        json!({
            "status": 405,
            "code": "method_not_allowed",
            "message": "POST is not allowed on /device",
            "details": {},
        })
    );
}

#[test]
fn sync_reply_is_synced_with_pages_when_sync_succeeds() {
    let reply = sync_reply(Ok(LastSync::Synced { pages: 1 }));

    assert_eq!(
        wire(&reply),
        json!({
            "status": 200,
            "code": "synced",
            "message": "sync complete",
            "details": { "pages": 1 },
        })
    );
}

#[test]
fn sync_reply_is_sync_failed_with_quirk_when_sync_fails() {
    let message = "sync failed (StorePaths): /kobo/<token>/v1/user/profile answered 404 Not Found";
    let tripped = sync_reply(Ok(LastSync::Failed {
        quirk: Some(Quirk::StorePaths),
        message: message.into(),
    }));
    let no_answer = sync_reply(Ok(LastSync::Failed {
        quirk: None,
        message: "sync failed: no answer from the server: refused".into(),
    }));

    assert_eq!(
        wire(&tripped),
        json!({
            "status": 502,
            "code": "sync_failed",
            "message": message,
            "details": { "quirk": "StorePaths" },
        })
    );
    assert_eq!(wire(&no_answer)["details"], json!({ "quirk": null }));
}

#[test]
fn sync_reply_is_sync_in_progress_when_sync_running() {
    let reply = sync_reply(Err(ControlError::SyncInProgress));

    assert_eq!(
        wire(&reply),
        json!({
            "status": 409,
            "code": "sync_in_progress",
            "message": "a sync is already running",
            "details": {},
        })
    );
}

#[test]
fn sync_reply_is_state_not_saved_when_save_fails() {
    let write_error = StateError::Write {
        path: "x.json".into(),
        source: std::io::Error::other("disk full"),
    };

    let reply = sync_reply(Err(ControlError::StateNotSaved(write_error)));

    assert_eq!(
        wire(&reply),
        json!({
            "status": 500,
            "code": "state_not_saved",
            "message": "device state not saved: cannot write x.json: disk full",
            "details": {},
        })
    );
}

#[tokio::test]
async fn post_actions_sync_returns_synced_reply_against_healthy_stub() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let body: Value = response.json().await.unwrap();
    assert_eq!(
        body,
        json!({
            "status": 200,
            "code": "synced",
            "message": "sync complete",
            "details": { "pages": 1 },
        })
    );
}

/// `GET /device`'s `details` once the device is no longer syncing, failing at a deadline.
async fn idle_device(base: &str) -> Value {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let body: Value = reqwest::get(format!("{base}/device"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        if body["details"]["syncing"] == false {
            return body["details"].clone();
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for the sync to end"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[tokio::test]
async fn post_sync_keeps_applied_pages_when_client_disconnects() {
    let gate = Arc::new(Notify::new());
    let stub = spawn_stub(Stub {
        sync_pages: vec![
            json!([new_entitlement("book-1", "Dune")]),
            json!([new_entitlement("book-2", "Dune Messiah")]),
        ],
        second_page_gate: Some(Arc::clone(&gate)),
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    let impatient = reqwest::Client::builder()
        .timeout(Duration::from_millis(300))
        .build()
        .unwrap();

    let result = impatient.post(format!("{base}/actions/sync")).send().await;
    gate.notify_one();

    assert!(result.unwrap_err().is_timeout());
    let device = idle_device(&base).await;
    assert_eq!(
        device["last_sync"],
        json!({ "result": "synced", "pages": 2 })
    );
    let titles: Vec<_> = device["library"]
        .as_object()
        .unwrap()
        .values()
        .map(|book| book["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, ["Dune", "Dune Messiah"]);
}

#[tokio::test]
async fn get_requests_returns_ok_reply_with_redacted_requests() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;
    reqwest::Client::new()
        .post(format!("{base}/actions/sync"))
        .send()
        .await
        .unwrap();

    let response = reqwest::get(format!("{base}/requests")).await.unwrap();

    assert_eq!(response.status(), 200);
    let body: Value = response.json().await.unwrap();
    assert_eq!(
        body,
        json!({
            "status": 200,
            "code": "ok",
            "message": "ok",
            "details": { "requests": [
                request("GET", "/v1/initialization"),
                request("POST", "/v1/analytics/gettests"),
                request("GET", "/v1/user/profile"),
                request("GET", "/v1/user/loyalty/benefits"),
                request("GET", "/v1/products/books/subscriptions"),
                request("GET", "/v1/deals"),
                request("GET", "/v1/library/sync"),
            ] },
        })
    );
    assert!(!body.to_string().contains(STUB_TOKEN));
}

fn empty_device_view() -> DeviceView {
    DeviceView {
        hardware_id: "HW-1".into(),
        url: "http://127.0.0.1:3000".into(),
        syncing: false,
        last_sync: None,
        sync_token: None,
        library: BTreeMap::new(),
    }
}

#[test]
fn reset_reply_is_reset_with_full_resend_workaround() {
    let reply = reset_reply(Ok(empty_device_view()));

    let body = wire(&reply);
    assert_eq!(body["status"], 200);
    assert_eq!(body["code"], "reset");
    assert_eq!(
        body["details"],
        json!({
            "hardware_id": "HW-1",
            "url": "http://127.0.0.1:3000",
            "syncing": false,
            "last_sync": null,
            "sync_token": null,
            "library": {},
        })
    );
    let message = body["message"].as_str().unwrap();
    assert!(message.contains("#2743"));
    assert!(message.contains("remove the device in Account settings and add it again"));
}

#[test]
fn reset_reply_is_sync_in_progress_when_sync_running() {
    let reply = reset_reply(Err(ControlError::SyncInProgress));

    assert_eq!(
        wire(&reply),
        json!({
            "status": 409,
            "code": "sync_in_progress",
            "message": "a sync is already running",
            "details": {},
        })
    );
}

#[tokio::test]
async fn put_reset_returns_reset_reply() {
    let stub = spawn_stub(Stub::default()).await;
    let dir = TempDir::new().unwrap();
    let base = serve(stub_control(&stub, dir.path().join("kobo.json"))).await;

    let response = reqwest::Client::new()
        .put(format!("{base}/reset"))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["code"], "reset");
    assert_eq!(body["details"]["hardware_id"], "HW-1");
    assert_eq!(body["details"]["library"], json!({}));
}
