//! `PUT /syncs/progress` and `GET /syncs/progress/{document}` — one book's position in
//! KOReader's vocabulary. A document is the partial MD5 of the file the device holds. A push is
//! stored as a whole percent (floored) plus the device's XPointer and exact fraction verbatim, the
//! XPointer converted to a CFI when the converter can prove it; a pull answers the stored XPointer
//! and fraction (stock KOReader reads an equal percentage as already in sync), else ones derived
//! from the CFI or percent another surface wrote. The protocol carries no device clock, so a push is dated
//! when it arrives, and no device name, so every position reads back as from device "Omnibus".

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db, kobo::KoboBookState, kosync::KosyncDocument, progress::ProgressError,
};
use omnibus_shared::{ProgressFormat, ProgressUpdate, EPUB_CFI_MAX_LEN};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;

use super::auth::KosyncUser;
use super::error;
use crate::backend::koreader::state::{convert, epub_source, position_xpointer};
use crate::backend::AppState;
use crate::http_errors::internal;

const DEVICE_NAME: &str = "Omnibus";
const DEVICE_ID: &str = "omnibus";

/// What a KOReader pushes. Every field is optional so a gap answers 2003, not a parse error.
#[derive(Deserialize)]
struct Push {
    document: Option<String>,
    progress: Option<String>,
    percentage: Option<f64>,
    device: Option<String>,
}

/// What a pull answers when a position exists.
#[derive(Serialize)]
struct Pull<'a> {
    document: &'a str,
    percentage: f64,
    progress: String,
    device: &'static str,
    device_id: &'static str,
    timestamp: i64,
}

fn invalid_request() -> Response {
    error(StatusCode::FORBIDDEN, 2003, "Invalid request")
}

/// `true` for 32 hex digits, the shape of a partial MD5.
fn is_digest(document: &str) -> bool {
    document.len() == 32 && document.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The book and edition a document names, or `None` when Omnibus cannot say.
async fn resolve(pool: &SqlitePool, document: &str) -> anyhow::Result<Option<KosyncDocument>> {
    db::kosync::resolve_document(pool, &document.to_ascii_lowercase()).await
}

/// Whether the device holds the book's source edition, the one every stored CFI is in.
async fn holds_source(pool: &SqlitePool, uuid: &str, held: Option<i64>) -> bool {
    let Some(held) = held else {
        return false;
    };
    epub_source(pool, uuid)
        .await
        .ok()
        .flatten()
        .is_some_and(|(source, _)| source == held)
}

/// The answer to a push no book can take: success, so the device does not queue and retry it
/// for every sideloaded book.
fn accepted_unstored(document: &str) -> Response {
    tracing::debug!(document, "kosync: push for a document no book matches");
    let timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    Json(json!({ "document": document, "timestamp": timestamp })).into_response()
}

/// Store a device's position for the book its document names.
pub(super) async fn put_progress(
    user: KosyncUser,
    State(state): State<AppState>,
    body: Bytes,
) -> Response {
    let Ok(push) = serde_json::from_slice::<Push>(&body) else {
        return invalid_request();
    };
    let document = push.document.unwrap_or_default();
    if !is_digest(&document) {
        return error(
            StatusCode::FORBIDDEN,
            2004,
            "Field 'document' not provided.",
        );
    }
    let (Some(progress), Some(percentage), Some(_device)) =
        (push.progress, push.percentage, push.device)
    else {
        return invalid_request();
    };
    if progress.trim().is_empty()
        || progress.chars().count() > EPUB_CFI_MAX_LEN
        || !(0.0..=1.0).contains(&percentage)
    {
        return invalid_request();
    }
    let (uuid, held) = match resolve(state.pool(), &document).await {
        Ok(Some(found)) => (found.book_uuid, found.book_file_id),
        Ok(None) => return accepted_unstored(&document),
        Err(e) => return internal("kosync resolve document", e),
    };

    // A path only addresses its own edition: a CFI is taken from the source edition alone, and
    // the XPointer is kept only beside the edition it was written in. Read-only, so it stays
    // outside the transaction; a miss stores the percent alone.
    let epub_cfi = if holds_source(state.pool(), &uuid, held).await {
        let xpointer = progress.clone();
        convert(state.pool(), &uuid, move |source| {
            db::koreader_position::xpointer_to_cfi(source, &xpointer)
        })
        .await
    } else {
        None
    };
    let update = ProgressUpdate {
        book_uuid: uuid,
        format: ProgressFormat::Epub,
        epub_cfi,
        audio_position_seconds: None,
        // Floored (rule 11); the epsilon undoes binary rounding such as 0.29 * 100 = 28.999999999999996.
        progress_percent: Some((percentage * 100.0 + 1e-9).floor() as i64),
        kobo_location: None,
        book_file_id: held,
        client_updated_at: None,
    };
    // BEGIN IMMEDIATE avoids a stale-snapshot 517 on concurrent writers (#1862).
    let mut tx = match state.pool().begin_with("BEGIN IMMEDIATE").await {
        Ok(tx) => tx,
        Err(e) => return internal("kosync put_progress begin", e),
    };
    let stored = match db::progress::upsert_koreader_progress_tx(
        &mut tx,
        user.0,
        &update,
        held.and(Some(progress.as_str())),
        Some(percentage),
    )
    .await
    {
        Ok(stored) => stored,
        Err(ProgressError::BookNotFound) => return accepted_unstored(&document),
        Err(ProgressError::Sqlx(e)) => return internal("kosync upsert_progress", e),
    };
    let started = db::read_status::start_unread_at_tx(
        &mut tx,
        user.0,
        &stored.book_uuid,
        stored.client_updated_at,
    );
    if let Err(e) = started.await {
        return internal("kosync start_unread", e);
    }
    if let Err(e) = tx.commit().await {
        return internal("kosync put_progress commit", e);
    }
    Json(json!({ "document": document, "timestamp": stored.client_updated_at })).into_response()
}

/// The exact position to hand a KOReader: its own XPointer, else one derived from the CFI
/// another surface stored, else one derived from the percent.
async fn xpointer_for(
    pool: &SqlitePool,
    uuid: &str,
    stored: &KoboBookState,
    percent: i64,
) -> Option<String> {
    if let Some(xpointer) = position_xpointer(pool, uuid, stored).await {
        return Some(xpointer);
    }
    let cfi = db::cross_format::derive_candidate_cfi(pool, uuid, percent as f64 / 100.0).await?;
    convert(pool, uuid, move |source| {
        db::koreader_position::cfi_to_xpointer(source, &cfi)
    })
    .await
}

/// The position held for the book a document names; `{}` when there is none to give.
pub(super) async fn get_progress(
    user: KosyncUser,
    State(state): State<AppState>,
    Path(document): Path<String>,
) -> Response {
    let nothing = || Json(json!({})).into_response();
    if !is_digest(&document) {
        return nothing();
    }
    let (uuid, held) = match resolve(state.pool(), &document).await {
        Ok(Some(found)) => (found.book_uuid, found.book_file_id),
        Ok(None) => return nothing(),
        Err(e) => return internal("kosync resolve document", e),
    };
    let mut states = match db::kobo::reading_state_for(
        state.pool(),
        user.0,
        std::slice::from_ref(&uuid),
    )
    .await
    {
        Ok(states) => states,
        Err(e) => return internal("kosync reading_state_for", e),
    };
    let Some(stored) = states.remove(&uuid) else {
        return nothing();
    };
    let Some(percent) = stored.percent else {
        return nothing();
    };
    // Another edition gets nothing exact: its paths address different text. And a
    // percentage without a progress would send KOReader to a nil position.
    let progress = if holds_source(state.pool(), &uuid, held).await {
        xpointer_for(state.pool(), &uuid, &stored, percent).await
    } else if held.is_some() && stored.book_file_id == held {
        stored.koreader_xpointer.clone()
    } else {
        None
    };
    let Some(progress) = progress else {
        return nothing();
    };
    Json(Pull {
        document: &document,
        percentage: stored.koreader_percentage.unwrap_or(percent as f64 / 100.0),
        progress,
        device: DEVICE_NAME,
        device_id: DEVICE_ID,
        timestamp: stored.progress_updated_at,
    })
    .into_response()
}
