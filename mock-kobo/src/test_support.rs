//! A stub Omnibus for the firmware tests: a local axum server that answers
//! the Kobo sync routes as a [`Stub`] says and records every request, so a
//! test can reproduce an old server bug and watch the device react to it.

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::{
    extract::State,
    http::{
        header::{CONTENT_TYPE, ETAG, HOST, LOCATION},
        HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri,
    },
    response::{IntoResponse, Response},
    Json, Router,
};
use serde_json::{json, Value};
use tokio::sync::Notify;

use crate::client::RequestRecord;
use crate::control::{Control, ControlError, LastSync};
use crate::device::Device;
use crate::state::SavedState;

/// The path token every stub device syncs with.
pub const STUB_TOKEN: &str = "stub-device-token";

/// A placeholder for the stub's own origin, which isn't known until it
/// binds its ephemeral port. `book_metadata`/`new_entitlement` build a
/// `DownloadUrls` entry with this in place of the base, and `library_sync`
/// substitutes the real one into every page before serving it.
pub const STUB_ORIGIN: &str = "{STUB_ORIGIN}";

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
    /// Build the `Resources` URLs on the request's `Host`, as Omnibus did before #2758.
    pub resources_from_host: bool,
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
    /// A URL `POST /api/auth/login` answers with a 307 redirect to, instead of `login_status`.
    pub login_redirects_to: Option<String>,
    /// The `token` in a successful login reply; `None` leaves it null.
    pub login_token: Option<&'static str>,
    /// What every cover thumbnail request answers with: `(content-type, bytes)`.
    /// `None` (the default) answers 404.
    pub cover: Option<(&'static str, &'static [u8])>,
    /// The status every `v1/download/<id>` request answers with.
    pub download_status: StatusCode,
    /// The status every state PUT answers with.
    pub state_status: StatusCode,
    /// The state PUT reply body; `None` (the default) is an all-`Success` reply.
    pub state_reply: Option<Value>,
    /// The status `POST .../checkforchanges` answers with.
    pub reading_services_status: StatusCode,
    /// The entitlement ids `checkforchanges` reports, minus any already
    /// served a 200 GET (see [`StubState::served_once`]) — the AC1 self-heal.
    pub reading_services_changed: Vec<String>,
    /// Each reported id's served annotation set. An id absent, or mapped to
    /// an empty vec, answers its GET `304`; a non-empty vec answers `200`.
    pub reading_services_annotations: BTreeMap<String, Vec<Value>>,
}

impl Default for Stub {
    fn default() -> Self {
        Self {
            initialization_status: StatusCode::OK,
            sends_api_token: true,
            gettests_accepts_post: true,
            store_path_status: StatusCode::OK,
            resources_under: "",
            resources_from_host: false,
            sync_pages: Vec::new(),
            sends_sync_token: true,
            sync_status: StatusCode::OK,
            sync_never_ends: false,
            sync_never_answers: false,
            second_page_gate: None,
            devices: Vec::new(),
            devices_status: StatusCode::OK,
            login_status: StatusCode::OK,
            login_redirects_to: None,
            login_token: Some(SESSION_TOKEN),
            cover: None,
            download_status: StatusCode::OK,
            state_status: StatusCode::OK,
            state_reply: None,
            reading_services_status: StatusCode::OK,
            reading_services_changed: Vec::new(),
            reading_services_annotations: BTreeMap::new(),
        }
    }
}

/// One request the stub received.
#[derive(Clone, Debug)]
pub struct Recorded {
    pub method: String,
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

    /// The `name` header each request carried, in order.
    pub fn header_on_every_request(&self, name: &str) -> Vec<Option<String>> {
        let requests = self.requests.lock().unwrap();
        requests
            .iter()
            .map(|r| {
                r.headers
                    .get(name)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_owned)
            })
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
    /// Ids whose annotations GET has already answered 200 — subtracted from
    /// `checkforchanges`'s next answer, the AC1 self-heal.
    served_once: Mutex<HashSet<String>>,
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
        served_once: Mutex::new(HashSet::new()),
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
    control_with(&stub.origin, None, device, state_path)
}

/// A `HW-1` device holding `STUB_TOKEN`, syncing against `url`, whose token was wired against `wired_url`.
pub fn control_wired_against(
    url: &str,
    wired_url: Option<&str>,
    state_path: PathBuf,
) -> Arc<Control> {
    control_with(url, wired_url, Device::new("HW-1"), state_path)
}

fn control_with(
    url: &str,
    wired_url: Option<&str>,
    device: Device,
    state_path: PathBuf,
) -> Arc<Control> {
    let saved = SavedState {
        url: None,
        token: STUB_TOKEN.to_owned(),
        wired_url: wired_url.map(str::to_owned),
        device,
    };
    Arc::new(Control::new(saved, url.to_owned(), state_path))
}

/// Start a sync on its own task, as the control API's handler does.
pub fn spawn_sync(
    control: &Arc<Control>,
) -> tokio::task::JoinHandle<Result<LastSync, ControlError>> {
    let control = Arc::clone(control);
    tokio::spawn(async move { control.sync(crate::downloads::DownloadPolicy::None).await })
}

/// Poll `condition` until it holds, failing the test at a deadline.
pub async fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for the condition"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// A server already holding the device auto-wire looks for, under `token`.
pub fn stub_with_device(token: &str) -> Stub {
    Stub {
        devices: vec![("Mock Kobo (kobo)".to_owned(), token.to_owned())],
        ..Stub::default()
    }
}

/// A stub that takes `library_sync` requests and never answers them.
pub fn never_answers() -> Stub {
    Stub {
        sync_never_answers: true,
        ..Stub::default()
    }
}

/// A stub whose one sync page holds the book "Dune".
pub fn dune_stub() -> Stub {
    Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        ..Stub::default()
    }
}

/// Enough bytes to satisfy `covers::decode`'s JPEG magic check.
pub const JPEG_BYTES: &[u8] = &[0xFF, 0xD8, 0xFF, 0x00];

/// Enough bytes to satisfy `covers::decode`'s PNG magic check.
pub const PNG_BYTES: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x00,
];

/// A WebP's magic bytes: `RIFF….WEBP`, which the device never decodes.
pub const WEBP_BYTES: &[u8] = b"RIFF\x00\x00\x00\x00WEBP";

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
        method: method.to_string(),
        path: uri.path().to_owned(),
        headers: headers.clone(),
        body: body.clone(),
    });
    if let Some(response) = omnibus_api(&state, uri.path(), &headers, &body) {
        return response;
    }
    if let Some(response) = reading_services(&state, &method, uri.path()) {
        return response;
    }
    let prefix = format!("/kobo/{STUB_TOKEN}");
    let Some(rest) = uri.path().strip_prefix(&prefix) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match rest {
        "/v1/initialization" => initialization(&state, &headers),
        "/v1/user/profile"
        | "/v1/user/loyalty/benefits"
        | "/v1/products/books/subscriptions"
        | "/v1/deals" => store_path(&state),
        _ if rest.starts_with("/v1/download/") => download(&state),
        _ if rest.starts_with("/v1/library/")
            && rest.ends_with("/state")
            && method == Method::PUT =>
        {
            state_put(&state)
        }
        _ => match rest.strip_prefix(state.stub.resources_under) {
            Some(resource) => answer_resource(&state, &method, resource).await,
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
}

/// `GET v1/download/{id}`, outside the resources map like the real server's route.
fn download(state: &StubState) -> Response {
    (state.stub.download_status, b"stub-kepub".as_slice()).into_response()
}

/// `PUT v1/library/{id}/state`, also off `api_endpoint` directly.
fn state_put(state: &StubState) -> Response {
    let status = state.stub.state_status;
    if !status.is_success() {
        return status.into_response();
    }
    let reply = state.stub.state_reply.clone().unwrap_or_else(|| {
        json!({
            "RequestResult": "Success",
            "UpdateResults": [{
                "StatusInfoResult": { "Result": "Success" },
                "CurrentBookmarkResult": { "Result": "Success" },
            }],
        })
    });
    (status, Json(reply)).into_response()
}

/// The Reading Services routes: `checkforchanges` and the annotations GET,
/// served at the bare origin rather than under `/kobo/<token>`.
fn reading_services(state: &StubState, method: &Method, path: &str) -> Option<Response> {
    if path == "/api/v3/content/checkforchanges" && *method == Method::POST {
        return Some(checkforchanges(state));
    }
    let id = path
        .strip_prefix("/api/v3/content/")
        .and_then(|rest| rest.strip_suffix("/annotations"))?;
    match *method {
        Method::GET => Some(annotations_get(state, id)),
        _ => None,
    }
}

/// `checkforchanges`'s answer: `reading_services_changed`, minus any id
/// already served a 200 GET this run.
fn checkforchanges(state: &StubState) -> Response {
    let status = state.stub.reading_services_status;
    if !status.is_success() {
        return status.into_response();
    }
    let served_once = state.served_once.lock().unwrap();
    let ids: Vec<&String> = state
        .stub
        .reading_services_changed
        .iter()
        .filter(|id| !served_once.contains(id.as_str()))
        .collect();
    (status, Json(ids)).into_response()
}

/// One book's annotations GET: `200` with its served set when non-empty
/// (marking it served, for the next `checkforchanges`), else `304 W/"0"`.
fn annotations_get(state: &StubState, id: &str) -> Response {
    let served = state
        .stub
        .reading_services_annotations
        .get(id)
        .cloned()
        .unwrap_or_default();
    if served.is_empty() {
        return (StatusCode::NOT_MODIFIED, [(ETAG, "W/\"0\"".to_owned())]).into_response();
    }
    state.served_once.lock().unwrap().insert(id.to_owned());
    Json(json!({ "annotations": served, "nextPageOffsetToken": null })).into_response()
}

/// One served annotation entry, with a `{"span":…}` location.
pub fn served_annotation(id: &str, color: &str, text: &str) -> Value {
    json!({
        "id": id,
        "highlightColor": color,
        "highlightedText": text,
        "location": {
            "span": {
                "chapterFilename": "OEBPS/ch1.xhtml",
                "startPath": "span#kobo\\.1\\.2",
                "startChar": 0,
                "endPath": "span#kobo\\.1\\.2",
                "endChar": 1,
            },
        },
    })
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
    if let Some(target) = &state.stub.login_redirects_to {
        let location = HeaderValue::from_str(target).unwrap();
        return (StatusCode::TEMPORARY_REDIRECT, [(LOCATION, location)]).into_response();
    }
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
        _ if resource.starts_with("/v1/books/") && resource.ends_with("/image.jpg") => cover(state),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// The quality-template thumbnail path's answer, from the `cover` knob.
fn cover(state: &StubState) -> Response {
    match state.stub.cover {
        Some((content_type, bytes)) => ([(CONTENT_TYPE, content_type)], bytes).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
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
    let page = fill_stub_origin(page.cloned().unwrap_or_else(|| json!([])), &state.base);
    let mut response = (state.stub.sync_status, Json(page)).into_response();
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

/// Replace every [`STUB_ORIGIN`] placeholder in a sync page with the stub's
/// real base, now that it's bound to a port.
fn fill_stub_origin(page: Value, base: &str) -> Value {
    let text = page.to_string().replace(STUB_ORIGIN, base);
    serde_json::from_str(&text).expect("re-parsing a re-serialized Value cannot fail")
}

/// A device that already holds the book `id`/`title`, via a [`new_entitlement`].
pub fn device_holding(id: &str, title: &str) -> Device {
    let mut device = Device::new("HW-1");
    device.apply(serde_json::from_value(new_entitlement(id, title)).unwrap());
    device
}

/// A `NewEntitlement` sync item as Omnibus sends it, trimmed to the fields
/// the device reads plus a reading state it must tolerate.
pub fn new_entitlement(id: &str, title: &str) -> Value {
    json!({ "NewEntitlement": {
        "BookEntitlement": { "Id": id, "IsRemoved": false, "Status": "Active" },
        "BookMetadata": book_metadata(id, title),
        "ReadingState": {
            "EntitlementId": id,
            "StatusInfo": { "Status": "ReadyToRead" },
            "CurrentBookmark": {},
        },
    }})
}

/// A `BookMetadata` block with no description, contributors or series.
/// `CoverImageId` defaults to `id` itself; a test after a cover change gives it its own.
pub fn book_metadata(id: &str, title: &str) -> Value {
    json!({
        "EntitlementId": id,
        "Title": title,
        "Description": "",
        "Contributors": [],
        "ContributorRoles": [],
        "CoverImageId": id,
        "DownloadUrls": [{
            "Format": "KEPUB",
            "Size": 0,
            "Url": format!("{STUB_ORIGIN}/kobo/{STUB_TOKEN}/v1/download/{id}"),
            "Platform": "Generic",
            "DrmType": "None",
        }],
    })
}

fn initialization(state: &StubState, headers: &HeaderMap) -> Response {
    let status = state.stub.initialization_status;
    if !status.is_success() {
        return status.into_response();
    }
    let origin = if state.stub.resources_from_host {
        format!("http://{}", headers[HOST].to_str().unwrap())
    } else {
        state.base.clone()
    };
    let prefix = format!("{origin}/kobo/{STUB_TOKEN}{}", state.stub.resources_under);
    let resources = json!({
        "library_sync": format!("{prefix}/v1/library/sync"),
        "get_tests_request": format!("{prefix}/v1/analytics/gettests"),
        "image_url_quality_template": format!(
            "{prefix}/v1/books/{{ImageId}}/thumbnail/{{Width}}/{{Height}}/{{Quality}}/{{IsGreyscale}}/image.jpg"
        ),
        "reading_services_host": origin,
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
