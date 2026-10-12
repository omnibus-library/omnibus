//! A stub Omnibus for the firmware tests: a local axum server that answers
//! the Kobo sync routes as a [`Stub`] says and records every request, so a
//! test can reproduce an old server bug and watch the device react to it.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::{
    extract::State,
    http::{header::LOCATION, HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    Json, Router,
};
use serde_json::{json, Value};
use tokio::sync::Notify;

use crate::client::RequestRecord;
use crate::control::Control;
use crate::device::Device;
use crate::state::SavedState;

/// The path token every stub device syncs with.
pub const STUB_TOKEN: &str = "stub-device-token";

/// The bearer token the stub's login hands out, and the only one its device routes accept.
pub const SESSION_TOKEN: &str = "stub-session";

/// How a stub answers. `Stub::default()` behaves like a healthy Omnibus.
#[derive(Clone)]
pub struct Stub {
    /// The status `v1/initialization` answers with; a non-2xx comes bare, with no `x-kobo-apitoken`.
    pub initialization_status: StatusCode,
    /// Whether `v1/initialization` carries an `x-kobo-apitoken`.
    pub sends_api_token: bool,
    /// Whether `gettests` takes a POST; `false` answers 405, as before #1499.
    pub gettests_accepts_post: bool,
    /// The status every firmware store path answers with; a 3xx points at a
    /// stub path that answers 200.
    pub store_path_status: StatusCode,
    /// Where under `/kobo/<token>` the resources map puts `library_sync` and
    /// `get_tests_request`; the default `/v1/...` paths answer 404 once moved.
    pub resources_under: &'static str,
    /// The `library_sync` bodies, served in turn; all but the last say `continue`.
    /// Empty means the server has no books: one `[]` page.
    pub sync_pages: Vec<Value>,
    /// Whether `library_sync` pages carry an `x-kobo-synctoken`.
    pub sends_sync_token: bool,
    /// The status every `library_sync` page answers with, its body and headers unchanged.
    pub sync_status: StatusCode,
    /// Say `continue` on every `library_sync` page, forever.
    pub sync_never_ends: bool,
    /// Leave `library_sync` requests open without ever answering.
    pub sync_never_answers: bool,
    /// Hold the second `library_sync` page, already requested, until this is notified.
    pub second_page_gate: Option<Arc<Notify>>,
    /// The `(name, token)` devices `POST /api/rpc/kobo/devices` lists, oldest first.
    pub devices: Vec<(String, String)>,
    /// The status `POST /api/rpc/kobo/devices` answers a signed-in caller with.
    pub devices_status: StatusCode,
    /// The status `POST /api/auth/login` answers with.
    pub login_status: StatusCode,
    /// The `token` in a successful login reply; `None` leaves it null.
    pub login_token: Option<&'static str>,
}

impl Default for Stub {
    fn default() -> Self {
        Self {
            initialization_status: StatusCode::OK,
            sends_api_token: true,
            gettests_accepts_post: true,
            store_path_status: StatusCode::OK,
            resources_under: "",
            sync_pages: Vec::new(),
            sends_sync_token: true,
            sync_status: StatusCode::OK,
            sync_never_ends: false,
            sync_never_answers: false,
            second_page_gate: None,
            devices: Vec::new(),
            devices_status: StatusCode::OK,
            login_status: StatusCode::OK,
            login_token: Some(SESSION_TOKEN),
        }
    }
}

/// One request the stub received.
#[derive(Clone, Debug)]
pub struct Recorded {
    pub path: String,
    pub headers: HeaderMap,
    pub body: String,
}

/// A running stub: the `api_endpoint` a device points at, and what it received.
pub struct RunningStub {
    /// The server's origin, with no path: what `--url` takes.
    pub origin: String,
    pub endpoint: String,
    pub requests: Arc<Mutex<Vec<Recorded>>>,
}

impl RunningStub {
    /// The requests received at `path`, in order.
    pub fn requests_to(&self, path: &str) -> Vec<Recorded> {
        let requests = self.requests.lock().unwrap();
        requests
            .iter()
            .filter(|r| r.path == path)
            .cloned()
            .collect()
    }

    /// The paths requested so far, in order.
    pub fn paths(&self) -> Vec<String> {
        let requests = self.requests.lock().unwrap();
        requests.iter().map(|r| r.path.clone()).collect()
    }
}

struct StubState {
    stub: Stub,
    base: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
    sync_calls: AtomicUsize,
}

/// Serve `stub` on an ephemeral local port.
pub async fn spawn_stub(stub: Stub) -> RunningStub {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let state = Arc::new(StubState {
        stub,
        base: base.clone(),
        requests: requests.clone(),
        sync_calls: AtomicUsize::new(0),
    });
    let app = Router::new().fallback(handle).with_state(state);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    RunningStub {
        endpoint: format!("{base}/kobo/{STUB_TOKEN}"),
        origin: base,
        requests,
    }
}

/// A fresh `HW-1` device holding `STUB_TOKEN`, syncing against `stub`, saving to `state_path`.
pub fn stub_control(stub: &RunningStub, state_path: PathBuf) -> Arc<Control> {
    stub_control_with(stub, Device::new("HW-1"), state_path)
}

/// [`stub_control`] for a device that already holds what it was given.
pub fn stub_control_with(stub: &RunningStub, device: Device, state_path: PathBuf) -> Arc<Control> {
    let saved = SavedState {
        url: None,
        token: STUB_TOKEN.to_owned(),
        wired_url: None,
        device,
    };
    Arc::new(Control::new(saved, stub.origin.clone(), state_path))
}

/// A stub whose one sync page holds the book "Dune".
pub fn dune_stub() -> Stub {
    Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        ..Stub::default()
    }
}

/// Each request as `METHOD path status`, in order.
pub fn request_lines(requests: &[RequestRecord]) -> Vec<String> {
    requests
        .iter()
        .map(|r| format!("{} {} {}", r.method, r.path, r.status))
        .collect()
}

async fn handle(
    State(state): State<Arc<StubState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: String,
) -> Response {
    state.requests.lock().unwrap().push(Recorded {
        path: uri.path().to_owned(),
        headers: headers.clone(),
        body: body.clone(),
    });
    if let Some(response) = omnibus_api(&state, uri.path(), &headers, &body) {
        return response;
    }
    let prefix = format!("/kobo/{STUB_TOKEN}");
    let Some(rest) = uri.path().strip_prefix(&prefix) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match rest {
        "/v1/initialization" => initialization(&state),
        "/v1/user/profile"
        | "/v1/user/loyalty/benefits"
        | "/v1/products/books/subscriptions"
        | "/v1/deals" => store_path(&state),
        _ => match rest.strip_prefix(state.stub.resources_under) {
            Some(resource) => answer_resource(&state, &method, resource).await,
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
}

/// The Omnibus `/api` routes auto-wire calls: login, the device list and create, then logout.
fn omnibus_api(state: &StubState, path: &str, headers: &HeaderMap, body: &str) -> Option<Response> {
    let signed_in = headers
        .get("authorization")
        .is_some_and(|value| value == format!("Bearer {SESSION_TOKEN}").as_str());
    match path {
        "/api/auth/login" => Some(login(state)),
        "/api/auth/logout" => Some(StatusCode::NO_CONTENT.into_response()),
        "/api/rpc/kobo/devices" | "/api/rpc/kobo/devices/create" if !signed_in => {
            Some(StatusCode::UNAUTHORIZED.into_response())
        }
        "/api/rpc/kobo/devices" => Some(list_devices(state)),
        "/api/rpc/kobo/devices/create" => Some(create_device(body)),
        _ => None,
    }
}

fn login(state: &StubState) -> Response {
    let status = state.stub.login_status;
    if !status.is_success() {
        return status.into_response();
    }
    (
        status,
        Json(json!({ "user": {}, "token": state.stub.login_token })),
    )
        .into_response()
}

fn device_row(id: usize, name: &str, token: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "token": token,
        "created_at": "2026-01-01T00:00:00Z",
        "last_seen_at": null,
    })
}

fn list_devices(state: &StubState) -> Response {
    if !state.stub.devices_status.is_success() {
        return state.stub.devices_status.into_response();
    }
    let rows: Vec<Value> = (1..)
        .zip(&state.stub.devices)
        .map(|(id, (name, token))| device_row(id, name, token))
        .collect();
    Json(rows).into_response()
}

fn create_device(body: &str) -> Response {
    let request: Value = serde_json::from_str(body).unwrap_or_default();
    let name = request["name"].as_str().unwrap_or_default();
    Json(device_row(99, name, STUB_TOKEN)).into_response()
}

/// A firmware store path's answer, redirecting to a healthy path when `store_path_status` is a 3xx.
fn store_path(state: &StubState) -> Response {
    let status = state.stub.store_path_status;
    let mut response = (status, Json(json!({}))).into_response();
    if status.is_redirection() {
        let target = format!("{}/kobo/{STUB_TOKEN}/v1/analytics/gettests", state.base);
        let location = HeaderValue::from_str(&target).unwrap();
        response.headers_mut().insert(LOCATION, location);
    }
    response
}

/// The routes the device reaches through the resources map.
async fn answer_resource(state: &StubState, method: &Method, resource: &str) -> Response {
    match resource {
        "/v1/analytics/gettests" if method == Method::POST && !state.stub.gettests_accepts_post => {
            StatusCode::METHOD_NOT_ALLOWED.into_response()
        }
        "/v1/analytics/gettests" => Json(json!({ "Result": "Success" })).into_response(),
        "/v1/library/sync" => library_sync(state).await,
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// The next sync page, with an `x-kobo-synctoken` naming it.
async fn library_sync(state: &StubState) -> Response {
    if state.stub.sync_never_answers {
        std::future::pending::<()>().await;
    }
    let call = state.sync_calls.fetch_add(1, Ordering::SeqCst);
    if let Some(gate) = state.stub.second_page_gate.as_ref().filter(|_| call == 1) {
        gate.notified().await;
    }
    let pages = &state.stub.sync_pages;
    let page = pages.get(call).or(pages.last());
    let body = Json(page.cloned().unwrap_or_else(|| json!([])));
    let mut response = (state.stub.sync_status, body).into_response();
    let headers = response.headers_mut();
    if state.stub.sends_sync_token {
        let token = HeaderValue::from_str(&format!("page-{}", call + 1)).unwrap();
        headers.insert(HeaderName::from_static("x-kobo-synctoken"), token);
    }
    if call + 1 < pages.len() || state.stub.sync_never_ends {
        let more = HeaderValue::from_static("continue");
        headers.insert(HeaderName::from_static("x-kobo-sync"), more);
    }
    response
}

/// A `NewEntitlement` sync item as Omnibus sends it, trimmed to the fields
/// the device reads plus a reading state it must tolerate.
pub fn new_entitlement(id: &str, title: &str) -> Value {
    json!({ "NewEntitlement": {
        "BookEntitlement": { "Id": id, "IsRemoved": false, "Status": "Active" },
        "BookMetadata": book_metadata(id, title),
        "ReadingState": { "EntitlementId": id, "StatusInfo": { "Status": "ReadyToRead" } },
    }})
}

/// A `BookMetadata` block with no description, contributors or series.
pub fn book_metadata(id: &str, title: &str) -> Value {
    json!({
        "EntitlementId": id,
        "Title": title,
        "Description": "",
        "Contributors": [],
        "ContributorRoles": [],
    })
}

fn initialization(state: &StubState) -> Response {
    let status = state.stub.initialization_status;
    if !status.is_success() {
        return status.into_response();
    }
    let prefix = format!(
        "{}/kobo/{STUB_TOKEN}{}",
        state.base, state.stub.resources_under
    );
    let resources = json!({
        "library_sync": format!("{prefix}/v1/library/sync"),
        "get_tests_request": format!("{prefix}/v1/analytics/gettests"),
    });
    let mut response = (status, Json(json!({ "Resources": resources }))).into_response();
    if state.stub.sends_api_token {
        response.headers_mut().insert(
            HeaderName::from_static("x-kobo-apitoken"),
            HeaderValue::from_static("e30="),
        );
    }
    response
}
