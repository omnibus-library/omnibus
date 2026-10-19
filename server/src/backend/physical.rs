//! Physical-collection REST handlers for the mobile client (`/api/physical/*`):
//! a book's library-wide copies, the caller's wishlist entry, and fileless-book
//! removal. Check-in lives in [`super::scan`]; web uses the `/api/rpc/physical*`
//! server functions.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, PhysicalError};
use omnibus_shared::physical::{
    PhysicalCopy, UpdateCopyNoteRequest, WishlistEntry, WishlistRemoval, WishlistSource,
};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Map a data-layer error to its HTTP shape. `BookHasFiles` is a 409: the
/// request is well-formed but conflicts with the book's current state.
fn physical_error(context: &'static str, e: PhysicalError) -> Response {
    match e {
        PhysicalError::BookNotFound => (StatusCode::NOT_FOUND, "book not found").into_response(),
        PhysicalError::CopyNotFound => {
            (StatusCode::NOT_FOUND, "physical copy not found").into_response()
        }
        PhysicalError::NotCopyOwner => (StatusCode::FORBIDDEN, "not your copy").into_response(),
        PhysicalError::BookHasFiles => (
            StatusCode::CONFLICT,
            "book still has files; remove them first",
        )
            .into_response(),
        other => internal(context, other),
    }
}

/// Reject a caller without `can_edit`. Deleting a fileless book removes it for
/// every user — same gate as metadata overrides. (A copy's own writes are
/// gated on ownership in the data layer instead.)
fn require_edit(user: &AuthUser) -> Option<Response> {
    (!user.is_admin && !user.can_edit)
        .then(|| (StatusCode::FORBIDDEN, "edit permission required").into_response())
}

/// List a book's physical copies
///
/// Every physical copy of the book, whoever checked it in, oldest check-in first. An
/// unknown uuid has no copies, so the list is empty.
#[utoipa::path(
    get,
    path = "/api/physical/{uuid}/copies",
    tag = "Physical books",
    operation_id = "list_physical_copies",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 200, description = "The book's physical copies.", body = Vec<PhysicalCopy>)),
)]
pub(super) async fn get_copies(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::list_physical_copies(&state.pool, &uuid).await {
        Ok(copies) => Json(copies).into_response(),
        Err(e) => physical_error("list_physical_copies", e),
    }
}

/// Change a copy's note
///
/// Replaces the copy's free-text note. A `null` or blank note clears it. Only the reader
/// who checked the copy in, or an admin, can change it.
#[utoipa::path(
    patch,
    path = "/api/physical/copies/{copy_id}",
    tag = "Physical books",
    params(("copy_id" = i64, Path, description = "The copy's id.")),
    request_body = UpdateCopyNoteRequest,
    responses(
        (status = 200, description = "The updated copy.", body = PhysicalCopy),
        (status = 400, description = "The note is longer than 4096 characters."),
        (status = 403, description = "Someone else checked the copy in."),
        (status = 404, description = "No copy has that id."),
    ),
)]
pub(super) async fn patch_copy_note(
    user: AuthUser,
    State(state): State<AppState>,
    Path(copy_id): Path<i64>,
    Json(req): Json<UpdateCopyNoteRequest>,
) -> Response {
    if let Err(msg) = req.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    let note = req.note.as_deref();
    match db::update_physical_copy_note(&state.pool, copy_id, user.id, user.is_admin, note).await {
        Ok(copy) => Json(copy).into_response(),
        Err(e) => physical_error("update_physical_copy_note", e),
    }
}

/// Remove a physical copy
///
/// Deletes one physical copy, say after you sold it. The book stays, even when this was
/// its last copy: `DELETE /api/physical/{uuid}` removes a book with no files. Only the
/// reader who checked the copy in, or an admin, can remove it.
#[utoipa::path(
    delete,
    path = "/api/physical/copies/{copy_id}",
    tag = "Physical books",
    operation_id = "delete_physical_copy",
    params(("copy_id" = i64, Path, description = "The copy's id.")),
    responses(
        (status = 204, description = "The copy is deleted."),
        (status = 403, description = "Someone else checked the copy in."),
        (status = 404, description = "No copy has that id."),
    ),
)]
pub(super) async fn delete_copy(
    user: AuthUser,
    State(state): State<AppState>,
    Path(copy_id): Path<i64>,
) -> Response {
    match db::delete_physical_copy(&state.pool, copy_id, user.id, user.is_admin).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => physical_error("delete_physical_copy", e),
    }
}

/// Get your wishlist entry for a book
///
/// Your physical wishlist entry for the book, or `null` when it isn't on your wishlist.
#[utoipa::path(
    get,
    path = "/api/physical/{uuid}/wishlist",
    tag = "Physical books",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 200, description = "Your entry, or `null`.", body = Option<WishlistEntry>)),
)]
pub(super) async fn get_wishlist_entry(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::get_wishlist_entry(&state.pool, user.id, &uuid).await {
        Ok(entry) => Json(entry).into_response(),
        Err(e) => physical_error("get_wishlist_entry", e),
    }
}

/// Add a book to your wishlist
///
/// Adds a book the library already has to your physical wishlist. Adding it again returns
/// the existing entry. To wishlist a book the library doesn't have, use
/// `POST /api/scan/wishlist`.
#[utoipa::path(
    post,
    path = "/api/physical/{uuid}/wishlist",
    tag = "Physical books",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "Your wishlist entry.", body = WishlistEntry),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn post_wishlist_entry(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::add_wishlist_entry(&state.pool, user.id, &uuid, WishlistSource::Detail).await {
        Ok(entry) => Json(entry).into_response(),
        Err(e) => physical_error("add_wishlist_entry", e),
    }
}

/// Remove a book from your wishlist
///
/// Removing a book that isn't on your wishlist still succeeds. A book that exists only
/// because someone wanted it (no file, no physical copy, no other reader's entry) is
/// deleted with its last entry, and `book_deleted` tells you so.
#[utoipa::path(
    delete,
    path = "/api/physical/{uuid}/wishlist",
    tag = "Physical books",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 200, description = "The entry is gone; whether the book went with it.", body = WishlistRemoval)),
)]
pub(super) async fn delete_wishlist_entry(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    // 200 with a body rather than 204: the client standing on a purged book's page
    // has to be told it is gone.
    match db::remove_wishlist_entry(&state.pool, user.id, &uuid).await {
        Ok(removal) => Json(removal).into_response(),
        Err(e) => physical_error("remove_wishlist_entry", e),
    }
}

/// Delete a book with no files
///
/// Deletes a book that has no digital files, with everything tied to it, such as its
/// physical copies, wishlist entries and ratings, for every reader. Clients offer it when
/// the last physical copy goes. Needs the edit permission.
#[utoipa::path(
    delete,
    path = "/api/physical/{uuid}",
    tag = "Physical books",
    operation_id = "delete_fileless_book",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 204, description = "The book is deleted."),
        (status = 403, description = "You lack the edit permission."),
        (status = 404, description = "No book has that uuid."),
        (status = 409, description = "The book still has digital files."),
    ),
)]
pub(super) async fn delete_book(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    if let Some(denied) = require_edit(&user) {
        return denied;
    }
    match db::delete_fileless_book(&state.pool, &uuid).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => physical_error("delete_fileless_book", e),
    }
}

#[cfg(test)]
mod tests;
