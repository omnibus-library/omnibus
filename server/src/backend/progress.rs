//! Progress-sync REST handlers for the mobile client (`/api/progress*`).
//!
//! Accepts a discriminated `{ format: "epub" | "audio" }` payload and fans
//! out to per-format write paths in `omnibus_db::progress`. Web clients use
//! the `/api/rpc/progress*` server functions in `omnibus_frontend::rpc`.

use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, progress::ProgressError};
use omnibus_shared::{
    BookProgress, ProgressQuery, ProgressRecord, ProgressUpdate, RecentProgressQuery, ResumePoint,
    SessionReport, SessionsRecorded, SESSION_BATCH_CAP,
};

use super::{internal, stats::viewer_error, AppState};
use crate::auth::AuthUser;

/// Ceiling on `?limit=` for `GET /api/progress/recent` — the surface is a
/// small "pick up where you left off" strip, not a history browser.
const RECENT_LIMIT_CAP: i64 = 20;

/// Save a position
///
/// Records where you are in a book in one format: `epub` with an `epub_cfi`, a
/// `progress_percent` or both, or `audio` with `audio_position_seconds`. The latest
/// position wins, judged by `client_updated_at` (the server's clock when absent), so a
/// write older than the stored position changes nothing. An `audio` position without
/// `book_file_id` also loses to a stored one that names a file of a multi-file audiobook.
/// The response is the position the server kept, yours or the stored one. A book you
/// haven't given a read status becomes `reading`; one you have keeps its status.
#[utoipa::path(
    post,
    path = "/api/progress",
    tag = "Progress",
    request_body = ProgressUpdate,
    responses(
        (status = 200, description = "The position the server kept.", body = ProgressRecord),
        (status = 400, description = "The position doesn't fit its format: it is missing or blank, sets a field of the other format, has `progress_percent` outside 0 to 100, a `book_file_id` below 1 or a negative `client_updated_at`, or `book_uuid` is blank."),
        (status = 404, description = "No book has that `book_uuid`."),
    ),
)]
pub(super) async fn post_progress(
    user: AuthUser,
    State(state): State<AppState>,
    Json(update): Json<ProgressUpdate>,
) -> Response {
    if let Err(msg) = update.validate() {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::progress::upsert_progress(&state.pool, user.id, &update).await {
        Ok(rec) => {
            // Epub CFI writes without a percent get one derived off-path;
            // the response carries the record as stored, percent follows.
            db::progress::spawn_epub_percent_derivation(state.pool.clone(), user.id, &rec);
            Json(rec).into_response()
        }
        Err(ProgressError::BookNotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "book not found").into_response()
        }
        Err(ProgressError::Sqlx(e)) => internal("upsert_progress", e),
    }
}

/// Get your positions in a book
///
/// Every position you hold in the book, one per format, with which one is furthest and the
/// cross-format link state. The body is `null` when no book has the uuid, and has empty
/// `records` when you have never opened the book.
#[utoipa::path(
    get,
    path = "/api/progress/{uuid}",
    tag = "Progress",
    params(("uuid" = String, Path, description = "The book's uuid."), ProgressQuery),
    responses(
        (status = 200, description = "Your positions, or `null` when no book has that uuid.", body = Option<BookProgress>),
        (status = 400, description = "`format` is not `epub` or `audio`."),
    ),
)]
pub(super) async fn get_progress(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(q): Query<ProgressQuery>,
) -> Response {
    match db::progress::book_progress(&state.pool, user.id, &uuid, q.format).await {
        Ok(progress) => Json(progress).into_response(),
        Err(ProgressError::BookNotFound) => Json(None::<BookProgress>).into_response(),
        Err(ProgressError::Sqlx(e)) => internal("book_progress", e),
    }
}

/// List the books you were last in
///
/// Your most recent positions, newest first, each with its book: a "pick up where you left
/// off" list. Send `user_id` for another reader's list.
#[utoipa::path(
    get,
    path = "/api/progress/recent",
    tag = "Progress",
    params(RecentProgressQuery),
    responses(
        (status = 200, description = "The most recent positions, newest first.", body = Vec<ResumePoint>),
        (status = 400, description = "`limit` or `user_id` isn't a whole number."),
        (status = 404, description = "`user_id` names no reader, or one who doesn't share their stats."),
    ),
)]
pub(super) async fn get_recent_progress(
    user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<RecentProgressQuery>,
) -> Response {
    // Rows whose book has vanished are skipped in the db layer.
    let limit = q.limit.clamp(1, RECENT_LIMIT_CAP);
    match db::stats::recent_progress_for_viewer(&state.pool, user.id, q.user_id, limit).await {
        Ok(points) => Json(points).into_response(),
        Err(e) => viewer_error("get_recent_progress", e),
    }
}

/// Record reading sessions
///
/// Stores a batch of up to 500 reading or listening sessions, each a stretch of time spent
/// in one book. Sessions for a book the server doesn't know are dropped. Give each session a
/// `client_id` and a batch is safe to send again: a repeated `client_id` isn't stored twice.
/// The batch is stored whole or not at all.
#[utoipa::path(
    post,
    path = "/api/progress/sessions",
    tag = "Progress",
    request_body = Vec<SessionReport>,
    responses(
        (status = 200, description = "The batch is stored.", body = SessionsRecorded),
        (status = 400, description = "A session is invalid: `book_uuid` is blank, a time is negative, `ended_at` is before `started_at`, `progress_units` is negative, `client_id` or `time_zone` is blank or too long, or `utc_offset_minutes` is outside -720 to 840."),
        (status = 422, description = "The batch holds more than 500 sessions."),
    ),
)]
pub(super) async fn post_sessions(
    user: AuthUser,
    State(state): State<AppState>,
    Json(reports): Json<Vec<SessionReport>>,
) -> Response {
    // Checked before any DB work. The batch runs in one transaction, so a mid-loop DB error
    // rolls back every row and the client can retry.
    if reports.len() > SESSION_BATCH_CAP {
        let msg = format!(
            "batch too large: {} records exceeds maximum of {}",
            reports.len(),
            SESSION_BATCH_CAP
        );
        return (axum::http::StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
    }
    for r in &reports {
        if let Err(msg) = r.validate() {
            return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
        }
    }
    // BEGIN IMMEDIATE avoids a stale-snapshot 517 on concurrent batches (#1862).
    let mut tx = match state.pool.begin_with("BEGIN IMMEDIATE").await {
        Ok(tx) => tx,
        Err(e) => return internal("begin", e),
    };
    // Pre-resolve every uuid in the batch in one round-trip (chunked at 499)
    // so the insert loop below performs only INSERTs — no per-row
    // `SELECT ... FROM books UNION merged_uuids` fires. Worst-case shrinks
    // from 2N to `chunks + N` queries per request (issue #633).
    let batch_uuids: Vec<String> = reports.iter().map(|r| r.book_uuid.clone()).collect();
    let resolved = match db::resolve_canonical_book_uuids_bulk_exec(&mut tx, &batch_uuids).await {
        Ok(m) => m,
        Err(e) => return internal("resolve_bulk", e),
    };
    let mut inserted = 0usize;
    for r in &reports {
        // Missing entry = uuid unknown in both `books` and `merged_uuids`.
        // Same best-effort skip semantics `record_session_tx` used to enforce
        // with its per-row resolve — the row is silently dropped so the
        // client's `recorded` count reflects what actually landed.
        let Some(canonical) = resolved.get(&r.book_uuid) else {
            continue;
        };
        if let Err(e) = db::progress::insert_session_tx(&mut tx, user.id, r, canonical).await {
            return internal("insert_session", e);
        }
        inserted += 1;
    }
    if let Err(e) = tx.commit().await {
        return internal("commit", e);
    }
    Json(SessionsRecorded { recorded: inserted }).into_response()
}

#[cfg(test)]
mod tests;
