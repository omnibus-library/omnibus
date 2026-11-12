//! A stub Omnibus for the wiring tests: it answers the routes wiring calls as configured and
//! records each call, its bearer token and its body.

use std::path::Path;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use omnibus_shared::DownloadClientKind;
use serde_json::{json, Value};

use super::{wire, WireError, Wired};

/// The mock's origin every wiring test passes.
pub const MOCK: &str = "http://127.0.0.1:7777";

/// The id the stub gives a created notification connection.
pub const CREATED_ID: i64 = 7;

const NOTIFICATIONS: &str = "/api/admin/notifications/connections";

/// What the stub answers.
pub struct Config {
    pub login: u16,
    pub redirect_login: bool,
    pub settings: u16,
    pub saved: Value,
    pub put: u16,
    /// How many saves answer 500 before `put` applies.
    pub put_500s: usize,
    pub test_indexer: (u16, &'static str),
    pub test_client: (u16, &'static str),
    pub repo_root: String,
    pub libraries: Value,
    /// The status of the notification connection list, and the connections in it.
    pub notifications: (u16, Vec<Value>),
    /// The status a notification connection save answers.
    pub ntfy_save: u16,
    pub ntfy_test: (u16, &'static str),
}

/// The stub's state: its config and every call it took.
pub struct Stub {
    pub config: Config,
    pub calls: Mutex<Vec<String>>,
    pub bearers: Mutex<Vec<(String, Option<String>)>>,
    pub bodies: Mutex<Vec<(String, Value)>>,
}

/// The requests settings read when nothing is saved.
pub fn nothing_saved() -> Value {
    json!({
        "prowlarr_url": null,
        "prowlarr_api_key_masked": null,
        "prowlarr_api_key_source": "none",
        "download_client_kind": "qbittorrent",
        "download_client_url": null,
        "download_client_username": null,
        "download_client_password_masked": null,
        "download_client_category": "",
        "download_client_path_prefix": null,
        "download_path_prefix": null,
    })
}

/// [`nothing_saved`] with Prowlarr and the download client at these addresses.
pub fn saved_with(prowlarr: Option<&str>, client: Option<&str>) -> Value {
    let mut saved = nothing_saved();
    saved["prowlarr_url"] = json!(prowlarr);
    saved["download_client_url"] = json!(client);
    saved
}

/// A saved ntfy connection as the list shows it, with token sign-in.
pub fn ntfy_connection(id: i64, name: &str, server_url: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "enabled": true,
        "events": ["request_needs_chooser"],
        "settings": {
            "kind": "ntfy", "server_url": server_url, "topic": "phone", "auth": "token",
            "username": null, "token_set": true, "password_set": false, "priority": 3,
            "tags": [], "include_details": true,
        },
        "last_delivery": null,
    })
}

/// A saved connection made from `input`, the body of a create or replace.
fn saved_from(id: i64, input: &Value) -> Value {
    let mut saved = ntfy_connection(id, input["name"].as_str().unwrap_or_default(), "");
    saved["settings"]["server_url"] = input["settings"]["server_url"].clone();
    saved
}

async fn handle(
    State(stub): State<Arc<Stub>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let route = format!("{method} {}", uri.path());
    stub.calls.lock().unwrap().push(route.clone());
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    stub.bearers
        .lock()
        .unwrap()
        .push((route.clone(), bearer.map(str::to_string)));
    let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    stub.bodies
        .lock()
        .unwrap()
        .push((route.clone(), body.clone()));
    let c = &stub.config;
    let status = |code: u16| StatusCode::from_u16(code).unwrap();
    let replaced = route
        .strip_prefix(&format!("PUT {NOTIFICATIONS}/"))
        .and_then(|id| id.parse::<i64>().ok());
    match route.as_str() {
        "POST /api/auth/login" if c.redirect_login => (
            StatusCode::TEMPORARY_REDIRECT,
            [(header::LOCATION, "/elsewhere")],
        )
            .into_response(),
        "POST /api/auth/login" => (status(c.login), Json(json!({"token": "tok"}))).into_response(),
        "POST /api/auth/logout" => StatusCode::OK.into_response(),
        "GET /api/_health" => Json(json!({
            "app": "omnibus", "status": "ok", "build_id": "1",
            "repo_root": c.repo_root, "version": "dev", "time": 0,
        }))
        .into_response(),
        "GET /api/settings" => Json(c.libraries.clone()).into_response(),
        "GET /api/admin/requests/settings" => {
            (status(c.settings), Json(c.saved.clone())).into_response()
        }
        "PUT /api/admin/requests/settings" => {
            let puts = stub
                .calls
                .lock()
                .unwrap()
                .iter()
                .filter(|r| **r == route)
                .count();
            let code = if puts <= c.put_500s { 500 } else { c.put };
            (status(code), "a field is too long").into_response()
        }
        "POST /api/admin/requests/settings/test-indexer" => {
            (status(c.test_indexer.0), c.test_indexer.1).into_response()
        }
        "POST /api/admin/requests/settings/test-client" => {
            (status(c.test_client.0), c.test_client.1).into_response()
        }
        "GET /api/admin/notifications/connections" => {
            let (code, connections) = &c.notifications;
            let list = json!({
                "connections": connections,
                "available_events": ["request_needs_chooser"],
            });
            (status(*code), Json(list)).into_response()
        }
        "POST /api/admin/notifications/connections" => {
            (status(c.ntfy_save), Json(saved_from(CREATED_ID, &body))).into_response()
        }
        "POST /api/admin/notifications/test" => {
            (status(c.ntfy_test.0), c.ntfy_test.1).into_response()
        }
        _ => match replaced {
            Some(id) => (status(c.ntfy_save), Json(saved_from(id, &body))).into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
}

/// A stub that accepts everything wiring sends, with nothing saved yet.
pub fn config() -> Config {
    Config {
        login: 200,
        redirect_login: false,
        settings: 200,
        saved: nothing_saved(),
        put: 200,
        put_500s: 0,
        test_indexer: (200, ""),
        test_client: (200, ""),
        repo_root: "/repo".into(),
        libraries: json!({"ebook_library_path": "/srv/ebooks", "audiobook_library_path": null}),
        notifications: (200, Vec::new()),
        ntfy_save: 200,
        ntfy_test: (204, ""),
    }
}

/// Serve a stub answering as `config` says; returns its origin.
pub async fn spawn_stub(config: Config) -> (String, Arc<Stub>) {
    let stub = Arc::new(Stub {
        config,
        calls: Mutex::default(),
        bearers: Mutex::default(),
        bodies: Mutex::default(),
    });
    let app = Router::new().fallback(handle).with_state(stub.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    tokio::spawn(async move { axum::serve(listener, app).await });
    (origin, stub)
}

/// Wire the stub at `server` with `kind` as the download client.
pub async fn run(server: &str, kind: DownloadClientKind) -> Result<Wired, WireError> {
    let seed = Some("admin:s3cret:with-colon");
    wire(server, seed, MOCK, kind, Path::new("/dl")).await
}

/// Every call the stub took, as `<METHOD> <path>`, in order.
pub fn calls(stub: &Stub) -> Vec<String> {
    stub.calls.lock().unwrap().clone()
}

/// The body of the last `route` call.
pub fn body_of(stub: &Stub, route: &str) -> Value {
    let bodies = stub.bodies.lock().unwrap();
    let found = bodies.iter().rev().find(|(r, _)| r == route);
    found.map(|(_, body)| body.clone()).unwrap()
}
