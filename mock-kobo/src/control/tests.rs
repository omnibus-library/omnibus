//! The control API over real local HTTP, driving a device that syncs against a stub Omnibus.

use std::path::PathBuf;

use reqwest::Method;
use serde_json::{json, Value};
use tempfile::TempDir;

use crate::config::Server;
use crate::store::DeviceStore;
use crate::test_support::{new_entitlement, spawn_stub, RunningStub, Stub, STUB_TOKEN};

use super::*;

/// A control API on an ephemeral port, its device saved under `dir/state/`.
struct Control {
    base: String,
    dir: TempDir,
}

impl Control {
    fn state_path(&self) -> PathBuf {
        self.dir.path().join("state").join("device.json")
    }

    /// Make every save fail: the state file's directory becomes a file.
    fn block_saves(&self) {
        std::fs::write(self.dir.path().join("state"), "").unwrap();
    }

    async fn call(&self, method: Method, path: &str) -> (u16, Value) {
        let url = format!("{}{path}", self.base);
        let response = reqwest::Client::new()
            .request(method, url)
            .send()
            .await
            .unwrap();
        (response.status().as_u16(), response.json().await.unwrap())
    }
}

async fn spawn_control(stub: &RunningStub) -> Control {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state").join("device.json");
    let store = DeviceStore::open(path, || "HW-1".to_owned()).unwrap();
    let suffix = format!("/kobo/{STUB_TOKEN}");
    let server = Server {
        url: stub.endpoint.strip_suffix(&suffix).unwrap().to_owned(),
        token: STUB_TOKEN.to_owned(),
    };
    let host = Arc::new(Mutex::new(DeviceHost::new(store, server)));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router(host)).await.unwrap() });
    Control { base, dir }
}

fn one_book() -> Stub {
    Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        ..Stub::default()
    }
}

#[tokio::test]
async fn post_sync_applies_books_and_saves_state() {
    let control = spawn_control(&spawn_stub(one_book()).await).await;

    let (status, reply) = control.call(Method::POST, "/actions/sync").await;

    let saved = DeviceStore::open(control.state_path(), || unreachable!()).unwrap();
    assert_eq!(
        (status, &reply["details"]["library"]["book-1"]["title"]),
        (200, &json!("Dune"))
    );
    assert_eq!(saved.state().device.library["book-1"].title, "Dune");
}

#[tokio::test]
async fn post_sync_reports_failure_in_reply_and_on_get_device() {
    let stub = spawn_stub(Stub {
        store_path_status: StatusCode::NOT_FOUND,
        ..Stub::default()
    })
    .await;
    let control = spawn_control(&stub).await;

    let (status, reply) = control.call(Method::POST, "/actions/sync").await;
    let (_, device) = control.call(Method::GET, "/device").await;

    let message = "sync failed (StorePaths): /kobo/<token>/v1/user/profile answered 404 Not Found";
    assert_eq!(
        (status, &reply["code"], &reply["message"]),
        (502, &json!("sync_failed"), &json!(message))
    );
    let shown = json!({ "ok": false, "message": message });
    assert_eq!(device["details"]["last_sync"], shown);
}

#[tokio::test]
async fn get_requests_returns_token_redacted_log() {
    let control = spawn_control(&spawn_stub(Stub::default()).await).await;
    control.call(Method::POST, "/actions/sync").await;

    let (status, reply) = control.call(Method::GET, "/requests").await;

    let first =
        json!({ "method": "GET", "path": "/kobo/<token>/v1/initialization", "status": 200 });
    let logged = reply["details"].as_array().unwrap();
    assert_eq!((status, logged.len(), &logged[0]), (200, 7, &first));
    assert!(!reply.to_string().contains(STUB_TOKEN), "{reply}");
}

#[tokio::test]
async fn put_reset_empties_library() {
    let control = spawn_control(&spawn_stub(one_book()).await).await;
    control.call(Method::POST, "/actions/sync").await;

    let (status, _) = control.call(Method::PUT, "/reset").await;

    let (_, device) = control.call(Method::GET, "/device").await;
    assert_eq!((status, &device["details"]["library"]), (200, &json!({})));
}

#[tokio::test]
async fn unknown_action_answers_404_in_reply_shape() {
    let control = spawn_control(&spawn_stub(Stub::default()).await).await;

    let (status, reply) = control.call(Method::POST, "/actions/frobnicate").await;

    let expected = json!({
        "status": 404,
        "code": "not_found",
        "message": "no action at POST /actions/frobnicate",
        "details": null,
    });
    assert_eq!((status, reply), (404, expected));
}

#[tokio::test]
async fn wrong_method_answers_405_in_reply_shape() {
    let control = spawn_control(&spawn_stub(Stub::default()).await).await;

    let (status, reply) = control.call(Method::GET, "/actions/sync").await;

    assert_eq!(
        (status, &reply["status"], &reply["code"]),
        (405, &json!(405), &json!("method_not_allowed"))
    );
}

#[tokio::test]
async fn post_sync_answers_500_when_state_cannot_be_saved() {
    let control = spawn_control(&spawn_stub(Stub::default()).await).await;
    control.block_saves();

    let (status, reply) = control.call(Method::POST, "/actions/sync").await;

    assert_eq!((status, &reply["code"]), (500, &json!("save_failed")));
}

#[tokio::test]
async fn put_reset_answers_500_when_state_cannot_be_saved() {
    let control = spawn_control(&spawn_stub(Stub::default()).await).await;
    control.block_saves();

    let (status, reply) = control.call(Method::PUT, "/reset").await;

    assert_eq!((status, &reply["code"]), (500, &json!("save_failed")));
}
