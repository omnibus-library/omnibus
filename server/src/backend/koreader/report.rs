//! `POST /koreader/v1/sync-report` — the plugin tells the server how a sync went, so
//! Settings can show the last sync and its error. Device-side failures (a failed write,
//! a delete that did not happen) are invisible to the server any other way.

use axum::{extract::State, http::StatusCode, response::IntoResponse, response::Response, Json};
use omnibus_db as db;
use serde::Deserialize;

use super::extractor::KoreaderDevice;
use crate::backend::AppState;
use crate::http_errors::internal;

/// Longest error kept, so a misbehaving plugin cannot fill the row.
const SYNC_ERROR_MAX_CHARS: usize = 500;

#[derive(Deserialize)]
pub struct SyncReport {
    /// What went wrong; `null` when the sync succeeded.
    error: Option<String>,
}

/// Record the reporting device's sync outcome.
pub async fn sync_report(
    device: KoreaderDevice,
    State(state): State<AppState>,
    Json(report): Json<SyncReport>,
) -> Response {
    let error: Option<String> = report
        .error
        .map(|e| e.chars().take(SYNC_ERROR_MAX_CHARS).collect());
    match db::kobo_devices::record_sync_report(state.pool(), device.device_id, error.as_deref())
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => internal("koreader record_sync_report", e),
    }
}
