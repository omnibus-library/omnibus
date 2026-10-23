//! `GET`/`PUT /koreader/v1/books/{uuid}/state` — one book's reading position and read
//! status, newest-wins on the event time the device recorded. A KOReader position is a
//! whole-book percent (the shape a Kobo writes for a CBZ), so web and iOS open it at the
//! derived CFI. Position and status arbitrate independently, each against its own stored
//! clock. The wire speaks KOReader's status tokens and is not part of the REST contract.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::read_status::ReadStatusError;
use omnibus_db::{self as db, kobo::KoboBookState, progress::ProgressError};
use omnibus_shared::{ProgressFormat, ProgressUpdate, ReadStatus, SetReadStatus};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::extractor::KoreaderDevice;
use crate::backend::kobo::reject_oversized_uuid;
use crate::backend::AppState;
use crate::http_errors::internal;

#[cfg(test)]
mod tests;

/// What the device reports about a book: the field(s) that changed, at one event time.
#[derive(Deserialize)]
pub struct StatePut {
    /// Whole-book percent, 0 to 100, floored on the device.
    #[serde(default)]
    percent: Option<i64>,
    /// KOReader's `summary.status`; only `reading` and `complete` sync.
    #[serde(default)]
    status: Option<String>,
    /// When the device recorded them, in Unix seconds on the device's clock.
    event_at: i64,
}

/// What the server holds for a book, in the device's vocabulary.
#[derive(Serialize)]
struct StateBody {
    position: Option<Position>,
    status: Option<StatusAt>,
}

#[derive(Serialize)]
struct Position {
    percent: i64,
    event_at: i64,
}

#[derive(Serialize)]
struct StatusAt {
    status: &'static str,
    event_at: i64,
}

/// The server's read status for a KOReader token; `None` for one that does not sync.
fn read_status_for(koreader: &str) -> Option<ReadStatus> {
    match koreader {
        "reading" => Some(ReadStatus::Reading),
        "complete" => Some(ReadStatus::Finished),
        _ => None,
    }
}

impl From<Option<KoboBookState>> for StateBody {
    fn from(stored: Option<KoboBookState>) -> Self {
        let Some(s) = stored else {
            return Self {
                position: None,
                status: None,
            };
        };
        let status = match s.status {
            ReadStatus::Reading => Some("reading"),
            ReadStatus::Finished => Some("complete"),
            ReadStatus::Unread => None,
        };
        Self {
            position: s.percent.map(|percent| Position {
                percent,
                event_at: s.progress_updated_at,
            }),
            status: status.map(|status| StatusAt {
                status,
                event_at: s.status_updated_at,
            }),
        }
    }
}

/// The state held for `uuid`, or `None` when no book has it (a merged-away uuid resolves).
async fn stored_state(
    pool: &SqlitePool,
    user_id: i64,
    uuid: &str,
) -> anyhow::Result<Option<StateBody>> {
    let Some(canonical) = db::resolve_canonical_book_uuid(pool, uuid).await? else {
        return Ok(None);
    };
    let mut states =
        db::kobo::reading_state_for(pool, user_id, std::slice::from_ref(&canonical)).await?;
    Ok(Some(states.remove(&canonical).into()))
}

/// The state the server holds for a book; 404 when no book has the uuid.
pub async fn get_state(
    device: KoreaderDevice,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    if let Some(rejected) = reject_oversized_uuid(&uuid) {
        return rejected;
    }
    answer(StatusCode::OK, state.pool(), device.user_id, &uuid).await
}

/// Store the device's position and/or status; 200 with the resulting state when the position
/// landed, 409 with the stored state when it was older than the stored position.
pub async fn put_state(
    device: KoreaderDevice,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(body): Json<StatePut>,
) -> Response {
    if let Some(rejected) = reject_oversized_uuid(&uuid) {
        return rejected;
    }
    // A device clock ahead of ours must not outrank every later write.
    let event_at = body
        .event_at
        .min(time::OffsetDateTime::now_utc().unix_timestamp());
    if body.percent.is_none() && body.status.is_none() {
        return (StatusCode::BAD_REQUEST, "percent or status is required").into_response();
    }
    let position = body.percent.map(|percent| ProgressUpdate {
        book_uuid: uuid.clone(),
        format: ProgressFormat::Epub,
        epub_cfi: None,
        audio_position_seconds: None,
        progress_percent: Some(percent),
        kobo_location: None,
        book_file_id: None,
        client_updated_at: Some(event_at),
    });
    let valid = match &position {
        Some(update) => update.validate(),
        None if event_at < 0 => Err("event_at must be non-negative".to_owned()),
        None => Ok(()),
    };
    if let Err(msg) = valid {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    // BEGIN IMMEDIATE avoids a stale-snapshot 517 on concurrent writers (#1862).
    let mut tx = match state.pool().begin_with("BEGIN IMMEDIATE").await {
        Ok(tx) => tx,
        Err(e) => return internal("koreader put_state begin", e),
    };
    let status = body.status.as_deref().and_then(read_status_for);
    if let Some(status) = status {
        let update = SetReadStatus {
            book_uuid: uuid.clone(),
            status,
        };
        match db::read_status::set_read_status_at_tx(&mut tx, device.user_id, &update, event_at)
            .await
        {
            Ok(_) => {}
            Err(ReadStatusError::BookNotFound) => return StatusCode::NOT_FOUND.into_response(),
            Err(ReadStatusError::Sqlx(e)) => return internal("koreader set_read_status", e),
        }
    }
    // A won write stores exactly the clamped time, so a larger stored one is a newer position.
    let mut stale = false;
    if let Some(position) = &position {
        stale = match db::progress::upsert_progress_tx(&mut tx, device.user_id, position).await {
            Ok(stored) => stored.client_updated_at > event_at,
            Err(ProgressError::BookNotFound) => return StatusCode::NOT_FOUND.into_response(),
            Err(ProgressError::Sqlx(e)) => return internal("koreader upsert_progress", e),
        };
    }
    if let Err(e) = tx.commit().await {
        return internal("koreader put_state commit", e);
    }
    if status.is_some() {
        // A status moves the stats summary's finished list.
        db::stats::invalidate_user(device.user_id);
    }
    let code = if stale {
        StatusCode::CONFLICT
    } else {
        StatusCode::OK
    };
    answer(code, state.pool(), device.user_id, &uuid).await
}

/// The stored state under `code`, or 404 when no book has the uuid.
async fn answer(code: StatusCode, pool: &SqlitePool, user_id: i64, uuid: &str) -> Response {
    match stored_state(pool, user_id, uuid).await {
        Ok(Some(body)) => (code, Json(body)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal("koreader stored_state", e),
    }
}
