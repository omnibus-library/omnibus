//! The control API: loopback HTTP routes over one running device, every reply
//! in the same `{status, code, message, details}` envelope.

use std::path::Path;
use std::sync::Arc;

use axum::extract::State;
use axum::http::{Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::control::{Control, DeviceView};

/// Every control API reply, success or failure: `{status, code, message, details}`.
#[derive(Debug, Serialize)]
pub struct Reply<T: Serialize> {
    /// The HTTP status, repeated in the body.
    pub status: u16,
    pub code: ReplyCode,
    /// A sentence for a person; callers branch on `code`.
    pub message: String,
    /// Always a JSON object.
    pub details: T,
}

/// `details` with nothing to add; serializes as `{}`.
#[derive(Debug, Serialize)]
pub struct NoDetails {}

/// What a reply means, stable for callers to branch on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplyCode {
    /// 200: `GET /device` or `GET /requests`.
    Ok,
    /// 200: `POST /actions/sync` succeeded.
    Synced,
    /// 502: the device's sync failed.
    SyncFailed,
    /// 409: a sync is already running.
    SyncInProgress,
    /// 200: `PUT /reset` wiped the device.
    Reset,
    /// 500: the state file could not be written.
    StateNotSaved,
    /// 404: no route at this path.
    NotFound,
    /// 405: the path exists, but not for this method.
    MethodNotAllowed,
}

impl<T: Serialize> Reply<T> {
    fn new(status: StatusCode, code: ReplyCode, message: impl Into<String>, details: T) -> Self {
        Self {
            status: status.as_u16(),
            code,
            message: message.into(),
            details,
        }
    }
}

impl<T: Serialize> IntoResponse for Reply<T> {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        (status, Json(self)).into_response()
    }
}

/// The control API routes over `control`, with 404/405 replies in the envelope.
pub fn router(control: Arc<Control>) -> Router {
    Router::new()
        .route("/device", get(get_device))
        .method_not_allowed_fallback(method_not_allowed)
        .fallback(not_found)
        .with_state(control)
}

async fn get_device(State(control): State<Arc<Control>>) -> Reply<DeviceView> {
    Reply::new(StatusCode::OK, ReplyCode::Ok, "ok", control.view())
}

async fn not_found(method: Method, uri: Uri) -> Reply<NoDetails> {
    let message = format!("no route for {method} {}", uri.path());
    Reply::new(
        StatusCode::NOT_FOUND,
        ReplyCode::NotFound,
        message,
        NoDetails {},
    )
}

async fn method_not_allowed(method: Method, uri: Uri) -> Reply<NoDetails> {
    let message = format!("{method} is not allowed on {}", uri.path());
    let code = ReplyCode::MethodNotAllowed;
    Reply::new(StatusCode::METHOD_NOT_ALLOWED, code, message, NoDetails {})
}

/// Bind the control API on 127.0.0.1 only, at `port` (0 for any free port).
pub async fn listen(port: u16) -> std::io::Result<tokio::net::TcpListener> {
    tokio::net::TcpListener::bind(("127.0.0.1", port)).await
}

/// The line `serve` prints once listening, for scripts to parse.
pub fn ready_line(port: u16, hardware_id: &str, state: &Path) -> String {
    format!(
        "MOCK_KOBO_READY port={port} hardware_id={hardware_id} state={}",
        state.display()
    )
}

#[cfg(test)]
mod tests;
