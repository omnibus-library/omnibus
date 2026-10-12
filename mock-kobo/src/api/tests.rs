//! The control API over real TCP: `listen`, `ready_line`, and each route's reply envelope.

use std::path::Path;
use std::sync::Arc;

use serde_json::{json, Value};
use tempfile::TempDir;

use crate::control::Control;
use crate::device::Device;
use crate::state::SavedState;
use crate::test_support::{new_entitlement, spawn_stub, stub_control, Stub, STUB_TOKEN};

use super::*;

/// Serve `control` on a free loopback port and return its base URL.
async fn serve(control: Control) -> String {
    let listener = listen(0).await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let app = router(Arc::new(control));
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
        device,
    };
    let control = Control::new(saved, stub.origin.clone(), dir.path().join("kobo.json"));
    let base = serve(control).await;

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
