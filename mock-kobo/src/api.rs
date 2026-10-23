//! The control API: loopback HTTP routes over one running device, every reply
//! in the same `{status, code, message, details}` envelope.

use std::path::Path;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::annotations::{NewHighlight, SpanRange, Swatch};
use crate::client::RequestRecord;
use crate::control::{Acted, Control, ControlError, DeviceView, LastSync, RESET_MESSAGE};
use crate::device::DeviceError;
use crate::downloads::DownloadPolicy;
use crate::firmware::Quirk;
use crate::reading::{KoboSpan, Percent};

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
    /// 400: the request body couldn't be used.
    InvalidRequest,
    /// 200: `POST /actions/download` downloaded every listed book.
    Downloaded,
    /// 502: a download failed.
    DownloadFailed,
    /// 200: `POST /actions/remove-download` cleared a book's downloaded flag.
    DownloadRemoved,
    /// 404: a book the device doesn't hold.
    UnknownBook,
    /// 409: the book named isn't downloaded yet.
    NotDownloaded,
    /// 404: a highlight id the book doesn't hold.
    UnknownHighlight,
    /// 200: `POST /actions/read` or `POST /actions/finish` sent the state PUT.
    StateSent,
    /// 502: the state PUT failed.
    StateFailed,
    /// 200: `POST /actions/highlight` or `POST /actions/delete-highlight` sent the PATCH.
    AnnotationSent,
    /// 502: the PATCH failed.
    AnnotationFailed,
}

/// What a reply's `details` carries, for routes whose outcomes differ.
#[derive(Debug, Serialize)]
#[serde(untagged)]
enum Details {
    Pages { pages: usize },
    Quirk { quirk: Option<Quirk> },
    Device(DeviceView),
    Requests { requests: Vec<RequestRecord> },
    Empty(NoDetails),
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
        .route("/actions/sync", post(post_sync))
        .route("/actions/download", post(post_download))
        .route("/actions/remove-download", post(post_remove_download))
        .route("/actions/read", post(post_read))
        .route("/actions/finish", post(post_finish))
        .route("/actions/highlight", post(post_highlight))
        .route("/actions/delete-highlight", post(post_delete_highlight))
        .route("/requests", get(get_requests))
        .route("/reset", put(put_reset))
        .method_not_allowed_fallback(method_not_allowed)
        .fallback(not_found)
        .with_state(control)
}

async fn get_device(State(control): State<Arc<Control>>) -> Reply<DeviceView> {
    Reply::new(StatusCode::OK, ReplyCode::Ok, "ok", control.view())
}

async fn post_sync(State(control): State<Arc<Control>>, body: Bytes) -> Reply<Details> {
    match parse_sync_policy(&body) {
        Ok(policy) => sync_reply(control.sync(policy).await),
        Err(message) => invalid_request_reply(message),
    }
}

/// `{"download": "none" | "all" | ["<uuid>", …]}`; an absent body or absent
/// field means [`DownloadPolicy::None`]. Parsed from raw bytes (no
/// `Content-Type` required) with `deny_unknown_fields`, so a misspelt key is
/// a rejection rather than a silent `None`.
fn parse_sync_policy(body: &[u8]) -> Result<DownloadPolicy, String> {
    if body.is_empty() {
        return Ok(DownloadPolicy::None);
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct SyncBody {
        #[serde(default)]
        download: Option<DownloadField>,
    }
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum DownloadField {
        Named(String),
        Listed(Vec<String>),
    }
    let parsed: SyncBody =
        serde_json::from_slice(body).map_err(|e| format!("invalid sync body: {e}"))?;
    match parsed.download {
        None => Ok(DownloadPolicy::None),
        Some(DownloadField::Listed(uuids)) => Ok(DownloadPolicy::Listed(uuids)),
        Some(DownloadField::Named(name)) if name == "none" => Ok(DownloadPolicy::None),
        Some(DownloadField::Named(name)) if name == "all" => Ok(DownloadPolicy::All),
        Some(DownloadField::Named(other)) => Err(format!(
            "invalid sync body: unknown download value \"{other}\""
        )),
    }
}

async fn post_download(State(control): State<Arc<Control>>, body: Bytes) -> Reply<Details> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct DownloadBody {
        books: Vec<String>,
    }
    let books = match serde_json::from_slice::<DownloadBody>(&body) {
        Ok(parsed) if !parsed.books.is_empty() => parsed.books,
        Ok(_) => return invalid_request_reply("\"books\" must not be empty"),
        Err(e) => return invalid_request_reply(format!("invalid download body: {e}")),
    };
    acted_reply(control.download(books).await)
}

async fn post_remove_download(State(control): State<Arc<Control>>, body: Bytes) -> Reply<Details> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct RemoveDownloadBody {
        book: String,
    }
    let book = match serde_json::from_slice::<RemoveDownloadBody>(&body) {
        Ok(parsed) => parsed.book,
        Err(e) => return invalid_request_reply(format!("invalid remove-download body: {e}")),
    };
    match control.remove_download(&book).await {
        Ok(view) => {
            let details = Details::Device(view);
            Reply::new(
                StatusCode::OK,
                ReplyCode::DownloadRemoved,
                "download removed",
                details,
            )
        }
        Err(error) => error_reply(&error),
    }
}

/// The reply for a finished action whose outcome is an [`Acted`]:
/// `Done` under `success`/`success_message`, `Failed` under `failure`.
/// Shared by download, read/finish and the two highlight actions, so each
/// only names its own codes and message.
fn acted_reply_as(
    result: Result<Acted, ControlError>,
    success: ReplyCode,
    success_message: &str,
    failure: ReplyCode,
) -> Reply<Details> {
    match result {
        Ok(Acted::Done(view)) => {
            Reply::new(StatusCode::OK, success, success_message, Details::Device(view))
        }
        Ok(Acted::Failed { quirk, message }) => {
            Reply::new(StatusCode::BAD_GATEWAY, failure, message, Details::Quirk { quirk })
        }
        Err(error) => error_reply(&error),
    }
}

/// The reply for a finished download action.
fn acted_reply(result: Result<Acted, ControlError>) -> Reply<Details> {
    acted_reply_as(
        result,
        ReplyCode::Downloaded,
        "downloaded",
        ReplyCode::DownloadFailed,
    )
}

/// The reply for a finished highlight or delete-highlight action.
fn annotation_reply(result: Result<Acted, ControlError>) -> Reply<Details> {
    acted_reply_as(
        result,
        ReplyCode::AnnotationSent,
        "annotation sent",
        ReplyCode::AnnotationFailed,
    )
}

async fn post_read(State(control): State<Arc<Control>>, body: Bytes) -> Reply<Details> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct ReadBody {
        book: String,
        percent: Percent,
        #[serde(default)]
        location: Option<LocationBody>,
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct LocationBody {
        source: String,
        value: String,
    }
    let parsed: ReadBody = match serde_json::from_slice(&body) {
        Ok(parsed) => parsed,
        Err(e) => return invalid_request_reply(format!("invalid read body: {e}")),
    };
    let location = parsed.location.map(|l| KoboSpan {
        source: l.source,
        value: l.value,
    });
    state_reply(control.read(parsed.book, parsed.percent, location).await)
}

async fn post_finish(State(control): State<Arc<Control>>, body: Bytes) -> Reply<Details> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct FinishBody {
        book: String,
    }
    let parsed: FinishBody = match serde_json::from_slice(&body) {
        Ok(parsed) => parsed,
        Err(e) => return invalid_request_reply(format!("invalid finish body: {e}")),
    };
    state_reply(control.finish(parsed.book).await)
}

/// The reply for a finished read or finish action.
fn state_reply(result: Result<Acted, ControlError>) -> Reply<Details> {
    acted_reply_as(
        result,
        ReplyCode::StateSent,
        "state sent",
        ReplyCode::StateFailed,
    )
}

/// The wire shape of a highlight's span range, under `"location"` in the request body.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LocationBody {
    chapter: String,
    start_span: String,
    start_char: u32,
    end_span: String,
    end_char: u32,
}

impl From<LocationBody> for SpanRange {
    fn from(body: LocationBody) -> Self {
        Self {
            chapter: body.chapter,
            start_span: body.start_span,
            start_char: body.start_char,
            end_span: body.end_span,
            end_char: body.end_char,
        }
    }
}

/// `"color"` in a highlight request body; unknown or malformed fails the whole parse.
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ColorBody {
    Yellow,
    Pink,
    Blue,
    Green,
}

impl From<ColorBody> for Swatch {
    fn from(body: ColorBody) -> Self {
        match body {
            ColorBody::Yellow => Self::Yellow,
            ColorBody::Pink => Self::Pink,
            ColorBody::Blue => Self::Blue,
            ColorBody::Green => Self::Green,
        }
    }
}

async fn post_highlight(State(control): State<Arc<Control>>, body: Bytes) -> Reply<Details> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct HighlightBody {
        book: String,
        text: String,
        color: ColorBody,
        #[serde(default)]
        note: Option<String>,
        // Required: a real device never highlights without a KoboSpan range.
        location: LocationBody,
    }
    let parsed: HighlightBody = match serde_json::from_slice(&body) {
        Ok(parsed) => parsed,
        Err(e) => return invalid_request_reply(format!("invalid highlight body: {e}")),
    };
    if parsed.text.is_empty() {
        return invalid_request_reply("\"text\" must not be empty");
    }
    let new = NewHighlight {
        text: parsed.text,
        color: parsed.color.into(),
        note: parsed.note,
        location: Some(parsed.location.into()),
    };
    annotation_reply(control.highlight(parsed.book, new).await)
}

async fn post_delete_highlight(State(control): State<Arc<Control>>, body: Bytes) -> Reply<Details> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct DeleteHighlightBody {
        book: String,
        highlight: String,
    }
    let parsed: DeleteHighlightBody = match serde_json::from_slice(&body) {
        Ok(parsed) => parsed,
        Err(e) => return invalid_request_reply(format!("invalid delete-highlight body: {e}")),
    };
    annotation_reply(control.delete_highlight(parsed.book, parsed.highlight).await)
}

async fn get_requests(State(control): State<Arc<Control>>) -> Reply<Details> {
    let requests = control.requests();
    Reply::new(
        StatusCode::OK,
        ReplyCode::Ok,
        "ok",
        Details::Requests { requests },
    )
}

async fn put_reset(State(control): State<Arc<Control>>) -> Reply<Details> {
    reset_reply(control.reset().await)
}

/// The reply for a finished `PUT /reset`.
fn reset_reply(result: Result<DeviceView, ControlError>) -> Reply<Details> {
    match result {
        Ok(view) => {
            let details = Details::Device(view);
            Reply::new(StatusCode::OK, ReplyCode::Reset, RESET_MESSAGE, details)
        }
        Err(error) => error_reply(&error),
    }
}

/// The reply for a finished `POST /actions/sync`.
fn sync_reply(result: Result<LastSync, ControlError>) -> Reply<Details> {
    match result {
        Ok(LastSync::Synced { pages }) => {
            let details = Details::Pages { pages };
            Reply::new(StatusCode::OK, ReplyCode::Synced, "sync complete", details)
        }
        Ok(LastSync::Failed { quirk, message }) => {
            let details = Details::Quirk { quirk };
            Reply::new(
                StatusCode::BAD_GATEWAY,
                ReplyCode::SyncFailed,
                message,
                details,
            )
        }
        Err(error) => error_reply(&error),
    }
}

/// The reply for a request body that couldn't be parsed or validated.
fn invalid_request_reply(message: impl Into<String>) -> Reply<Details> {
    Reply::new(
        StatusCode::BAD_REQUEST,
        ReplyCode::InvalidRequest,
        message,
        Details::Empty(NoDetails {}),
    )
}

/// The reply for a control problem, whichever action hit it.
fn error_reply(error: &ControlError) -> Reply<Details> {
    let (status, code) = match error {
        ControlError::SyncInProgress => (StatusCode::CONFLICT, ReplyCode::SyncInProgress),
        ControlError::StateNotSaved(_) => {
            (StatusCode::INTERNAL_SERVER_ERROR, ReplyCode::StateNotSaved)
        }
        ControlError::Device(DeviceError::UnknownBook(_)) => {
            (StatusCode::NOT_FOUND, ReplyCode::UnknownBook)
        }
        ControlError::Device(DeviceError::NotDownloaded(_)) => {
            (StatusCode::CONFLICT, ReplyCode::NotDownloaded)
        }
        ControlError::Device(DeviceError::UnknownHighlight(_)) => {
            (StatusCode::NOT_FOUND, ReplyCode::UnknownHighlight)
        }
    };
    Reply::new(
        status,
        code,
        error.to_string(),
        Details::Empty(NoDetails {}),
    )
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

/// The line `serve` prints once listening, for scripts to parse; `pid` is what to `kill`.
pub fn ready_line(port: u16, hardware_id: &str, state: &Path, pid: u32) -> String {
    format!(
        "MOCK_KOBO_READY port={port} hardware_id={hardware_id} state={} pid={pid}",
        state.display()
    )
}

#[cfg(test)]
mod tests;
