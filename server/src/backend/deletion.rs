//! Admin book-deletion REST endpoints: what a book's delete dialog lists,
//! and the delete itself. Thin HTTP shells over
//! `db::book_deletion_manifest` / `db::delete_book_items` — the same helpers
//! the web-facing `/api/rpc/books/{deletion-manifest,delete-files}` server
//! functions call.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use omnibus_shared::{
    BookDeletionImpact, BookDeletionManifest, DeleteBookFilesRequest, DeleteBookFilesResult,
};

use omnibus_db as db;

use super::{internal, AppState};
use crate::auth::AdminUser;

#[cfg(test)]
mod tests;

/// Preview deleting a book
///
/// What `POST /api/books/{uuid}/delete-files` can delete for this book, its files and
/// physical copies, and how much reader data deleting all of them would take with the
/// book. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/books/{uuid}/deletion-manifest",
    tag = "Admin",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The book's files and copies, and the reader data at stake.", body = BookDeletionManifest),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn get_deletion_manifest(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    // Repeats the `AdminUser` gate of `rpc_book_deletion_manifest` in
    // `omnibus_frontend::rpc::books`; changing one side's gate means changing the other.
    match db::book_deletion_manifest(&state.pool, &uuid).await {
        Ok(m) => Json(BookDeletionManifest {
            files: m.files,
            copies: m.copies,
            impact: BookDeletionImpact {
                highlights: m.impact.highlights,
                journal_entries: m.impact.journal_entries,
                bookmarks: m.impact.bookmarks,
                reading_sessions: m.impact.reading_sessions,
                listening_sessions: m.impact.listening_sessions,
                ratings: m.impact.ratings,
                shelves: m.impact.shelves,
            },
        })
        .into_response(),
        Err(e @ db::DeleteError::BookNotFound) => {
            (StatusCode::NOT_FOUND, e.to_string()).into_response()
        }
        Err(e) => internal("book deletion manifest", e),
    }
}

/// Delete a book's files or copies
///
/// Deletes the listed files from disk and the listed physical copies from the collection.
/// When nothing of the book is left, the book goes too, with every reader's data for it:
/// the `impact` that `GET /api/books/{uuid}/deletion-manifest` counts. This can't be undone.
/// Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/books/{uuid}/delete-files",
    tag = "Admin",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body = DeleteBookFilesRequest,
    responses(
        (status = 200, description = "What was deleted, and whether the book went with it.", body = DeleteBookFilesResult),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No book has that uuid."),
        (status = 422, description = "A file or copy id isn't one of this book's; the body says which."),
    ),
)]
pub(super) async fn post_delete_book_files(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(req): Json<DeleteBookFilesRequest>,
) -> Response {
    // Mirrors `rpc_delete_book_files`; same gate-parity note as `get_deletion_manifest`.
    match db::delete_book_items(&state.pool, &uuid, &req.file_ids, &req.copy_ids).await {
        Ok(out) => Json(DeleteBookFilesResult {
            deleted_file_ids: out.deleted_file_ids,
            deleted_copy_ids: out.deleted_copy_ids,
            book_deleted: out.book_deleted,
        })
        .into_response(),
        Err(e @ db::DeleteError::BookNotFound) => {
            (StatusCode::NOT_FOUND, e.to_string()).into_response()
        }
        // The book exists but the body names an item that isn't its: the
        // request is well-formed and wrong, not missing.
        Err(e @ (db::DeleteError::FileNotFound(_) | db::DeleteError::CopyNotFound(_))) => {
            (StatusCode::UNPROCESSABLE_ENTITY, e.to_string()).into_response()
        }
        Err(e) => internal("delete book files", e),
    }
}
