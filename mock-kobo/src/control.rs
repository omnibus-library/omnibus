//! The device's control API: local HTTP that drives one long-running device.
//! Every reply, success or failure, has one JSON shape —
//! `{status, code, message, details}` — so a script reads them all alike.

use std::sync::Arc;

use axum::extract::State;
use axum::http::{Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::host::DeviceHost;
use crate::store::StoreError;

/// The device a control API drives, shared with any other front end.
pub type SharedHost = Arc<Mutex<DeviceHost>>;

/// Every control API reply.
#[derive(Debug, Serialize)]
pub struct Reply {
    /// The reply's HTTP status.
    pub status: u16,
    /// The outcome for a script: `ok`, `sync_failed`, `save_failed`,
    /// `not_found` or `method_not_allowed`.
    pub code: &'static str,
    /// The outcome for a person; never carries the device token.
    pub message: String,
    /// The route's payload, or `null` when it failed.
    pub details: Value,
}

/// The control API over `host`. It has no auth, so bind it to 127.0.0.1 only.
pub fn router(host: SharedHost) -> Router {
    Router::new()
        .route("/actions/sync", post(sync))
        .route("/device", get(device))
        .route("/requests", get(requests))
        .route("/reset", put(reset))
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .with_state(host)
}

async fn sync(State(host): State<SharedHost>) -> Reply {
    let mut host = host.lock().await;
    match host.sync().await {
        Ok(last) if last.ok => Reply::ok(last.message, host.view()),
        Ok(last) => Reply::new(
            StatusCode::BAD_GATEWAY,
            "sync_failed",
            last.message,
            host.view(),
        ),
        Err(error) => Reply::save_failed(&error),
    }
}

async fn device(State(host): State<SharedHost>) -> Reply {
    let host = host.lock().await;
    Reply::ok("the device as it stands".to_owned(), host.view())
}

async fn requests(State(host): State<SharedHost>) -> Reply {
    let host = host.lock().await;
    let requests = host.requests();
    let message = format!("{} request(s) in the last sync", requests.len());
    Reply::ok(message, requests)
}

async fn reset(State(host): State<SharedHost>) -> Reply {
    let mut host = host.lock().await;
    match host.reset() {
        Ok(()) => Reply::ok("device reset".to_owned(), host.view()),
        Err(error) => Reply::save_failed(&error),
    }
}

async fn not_found(method: Method, uri: Uri) -> Reply {
    let message = format!("no action at {method} {}", uri.path());
    Reply::new(StatusCode::NOT_FOUND, "not_found", message, Value::Null)
}

async fn method_not_allowed(method: Method, uri: Uri) -> Reply {
    let message = format!("{} does not take {method}", uri.path());
    let status = StatusCode::METHOD_NOT_ALLOWED;
    Reply::new(status, "method_not_allowed", message, Value::Null)
}

impl Reply {
    fn new(
        status: StatusCode,
        code: &'static str,
        message: String,
        details: impl Serialize,
    ) -> Self {
        Self {
            status: status.as_u16(),
            code,
            message,
            details: serde_json::to_value(details).unwrap_or(Value::Null),
        }
    }

    fn ok(message: String, details: impl Serialize) -> Self {
        Self::new(StatusCode::OK, "ok", message, details)
    }

    fn save_failed(error: &StoreError) -> Self {
        let status = StatusCode::INTERNAL_SERVER_ERROR;
        Self::new(status, "save_failed", error.to_string(), Value::Null)
    }
}

impl IntoResponse for Reply {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        (status, Json(self)).into_response()
    }
}

#[cfg(test)]
mod tests;
