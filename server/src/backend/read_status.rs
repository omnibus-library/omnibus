//! Read/unread-state REST handlers for the mobile client (`/api/read-status*`).
//! Set/get the per-`(user, book)` read state; writes are last-write-wins and the
//! uuid is validated at the boundary (400 blank, 404 unindexed book). Web clients
//! use the `/api/rpc/read-status/*` server functions in `omnibus_frontend::rpc`.

use axum::{
    extract::{Path, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, read_status::ReadStatusError};
use omnibus_shared::{ReadStatusRecord, SetReadStatus};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Set a book's read status
///
/// Marks a book as unread, reading or finished for you, replacing its previous status.
#[utoipa::path(
    put,
    path = "/api/read-status",
    tag = "Read status",
    request_body = SetReadStatus,
    responses(
        (status = 200, description = "The status as stored.", body = ReadStatusRecord),
        (status = 400, description = "`book_uuid` is blank or over 64 bytes."),
        (status = 404, description = "No book has that `book_uuid`."),
    ),
)]
pub(super) async fn put_read_status(
    user: AuthUser,
    State(state): State<AppState>,
    Json(update): Json<SetReadStatus>,
) -> Response {
    if let Err(msg) = update.validate() {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::read_status::set_read_status(&state.pool, user.id, &update).await {
        Ok(rec) => Json(rec).into_response(),
        Err(ReadStatusError::BookNotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "book not found").into_response()
        }
        Err(ReadStatusError::Sqlx(e)) => internal("set_read_status", e),
    }
}

/// Get a book's read status
///
/// Your read status for the book. Saving a position sets `reading` when you have no
/// status. The body is `null` when you have neither set one nor saved a position, or no
/// book has the uuid; treat that as `unread`.
#[utoipa::path(
    get,
    path = "/api/read-status/{uuid}",
    tag = "Read status",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 200, description = "Your status, or `null`.", body = Option<ReadStatusRecord>)),
)]
pub(super) async fn get_read_status(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::read_status::get_read_status(&state.pool, user.id, &uuid).await {
        Ok(rec) => Json(rec).into_response(),
        Err(e) => internal("get_read_status", e),
    }
}

#[cfg(test)]
mod tests;
