//! A stub Omnibus for the firmware tests: a local axum server that answers
//! the Kobo sync routes as a [`Stub`] says and records every request, so a
//! test can reproduce an old server bug and watch the device react to it.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::{
    extract::State,
    http::{header::LOCATION, HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    Json, Router,
};
use serde_json::{json, Value};

/// The path token every stub device syncs with.
pub const STUB_TOKEN: &str = "stub-device-token";

/// How a stub answers. `Stub::default()` behaves like a healthy Omnibus.
#[derive(Clone)]
pub struct Stub {
    /// The `x-kobo-apitoken` sent on `v1/initialization`; `None` leaves it off.
    pub api_token: Option<&'static str>,
    /// Whether `gettests` takes a POST; `false` answers 405, as before #1499.
    pub gettests_accepts_post: bool,
    /// The status every firmware store path answers with; a 3xx points at a
    /// stub path that answers 200.
    pub store_path_status: StatusCode,
    /// Where under `/kobo/<token>` the resources map puts `library_sync` and
    /// `get_tests_request`; the default `/v1/...` paths answer 404 once moved.
    pub resources_under: &'static str,
    /// The `library_sync` bodies, served in turn; all but the last say `continue`.
    pub sync_pages: Vec<Value>,
    /// Say `continue` on every `library_sync` page, forever.
    pub sync_never_ends: bool,
}

impl Default for Stub {
    fn default() -> Self {
        Self {
            api_token: Some("e30="),
            gettests_accepts_post: true,
            store_path_status: StatusCode::OK,
            resources_under: "",
            sync_pages: vec![json!([])],
            sync_never_ends: false,
        }
    }
}

/// One request the stub received.
#[derive(Clone, Debug)]
pub struct Recorded {
    pub path: String,
    pub headers: HeaderMap,
}

/// A running stub: the `api_endpoint` a device points at, and what it received.
pub struct RunningStub {
    pub endpoint: String,
    pub requests: Arc<Mutex<Vec<Recorded>>>,
}

impl RunningStub {
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
        requests,
    }
}

async fn handle(
    State(state): State<Arc<StubState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    state.requests.lock().unwrap().push(Recorded {
        path: uri.path().to_owned(),
        headers,
    });
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
            Some(resource) => answer_resource(&state, &method, resource),
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
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
fn answer_resource(state: &StubState, method: &Method, resource: &str) -> Response {
    match resource {
        "/v1/analytics/gettests" if method == Method::POST && !state.stub.gettests_accepts_post => {
            StatusCode::METHOD_NOT_ALLOWED.into_response()
        }
        "/v1/analytics/gettests" => Json(json!({ "Result": "Success" })).into_response(),
        "/v1/library/sync" => library_sync(state),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// The next sync page, with an `x-kobo-synctoken` naming it.
fn library_sync(state: &StubState) -> Response {
    let call = state.sync_calls.fetch_add(1, Ordering::SeqCst);
    let pages = &state.stub.sync_pages;
    let mut response = Json(pages[call.min(pages.len() - 1)].clone()).into_response();
    let headers = response.headers_mut();
    let token = HeaderValue::from_str(&format!("page-{}", call + 1)).unwrap();
    headers.insert(HeaderName::from_static("x-kobo-synctoken"), token);
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
    let prefix = format!(
        "{}/kobo/{STUB_TOKEN}{}",
        state.base, state.stub.resources_under
    );
    let resources = json!({
        "library_sync": format!("{prefix}/v1/library/sync"),
        "get_tests_request": format!("{prefix}/v1/analytics/gettests"),
    });
    let mut response = Json(json!({ "Resources": resources })).into_response();
    if let Some(token) = state.stub.api_token {
        response.headers_mut().insert(
            HeaderName::from_static("x-kobo-apitoken"),
            HeaderValue::from_static(token),
        );
    }
    response
}
