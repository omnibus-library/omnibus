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

/// `GET /api/books/{uuid}/deletion-manifest` — the book's deletable items
/// (files + physical copies) and the user data a total delete would take
/// with them. Mirrors `rpc_book_deletion_manifest` in
/// `omnibus_frontend::rpc::books`, whose `AdminUser` gate this repeats —
/// there is no shared gate helper between the two crates, so changing one
/// side's gate means changing the other.
pub(super) async fn get_deletion_manifest(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
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

/// `POST /api/books/{uuid}/delete-files` — delete the given items:
/// `file_ids` are `book_files` rows (removed from disk too), `copy_ids` are
/// physical copies (un-recorded only). When every item goes, the book and
/// everything keyed to its uuid go with it — irreversible, which is why the
/// client confirms first. Mirrors `rpc_delete_book_files`, with the same
/// gate-parity note as [`get_deletion_manifest`].
pub(super) async fn post_delete_book_files(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(req): Json<DeleteBookFilesRequest>,
) -> Response {
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
