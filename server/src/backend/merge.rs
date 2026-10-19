//! Admin book-merge REST endpoints: find a merge partner, absorb one book
//! into another, and reverse a recorded merge. Thin HTTP shells over
//! `db::merge_candidates` / `db::merge_books` / `db::undo_merge` — the same
//! helpers the web-facing `/api/rpc/merge-books*` server functions call.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use omnibus_shared::{
    search_query_too_long, EbookMetadata, MergeBooksRequest, MergeBooksResult,
    MergeCandidatesQuery, UndoMergeRequest, UndoMergeResult,
};

use omnibus_db as db;

use super::{internal, AppState};
use crate::auth::AdminUser;

#[cfg(test)]
mod tests;

/// Find books to merge with
///
/// Searches the ebook and audiobook libraries for a book to merge another into, and returns
/// up to 20 matches. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/books/merge/candidates",
    tag = "Admin",
    params(MergeCandidatesQuery),
    responses(
        (status = 200, description = "The matching books.", body = Vec<EbookMetadata>),
        (status = 400, description = "`q` is missing or over 1024 bytes."),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_merge_candidates(
    _admin: AdminUser,
    State(state): State<AppState>,
    Query(params): Query<MergeCandidatesQuery>,
) -> Response {
    // Mirrors `rpc_merge_candidates`, including its query-length rejection (400 here,
    // where the RPC returns an error string).
    if search_query_too_long(&params.q) {
        return (StatusCode::BAD_REQUEST, "query too long").into_response();
    }
    match db::merge_candidates(&state.pool, &params.q).await {
        Ok(books) => Json(books).into_response(),
        Err(e) => internal("merge candidates", e),
    }
}

/// Merge two books
///
/// Folds the source book into the target: the target takes the source's files, links,
/// identifiers and every reader's progress, highlights and other data, and the source
/// book disappears. `POST /api/books/merge/undo` with the returned `merge_log_id` reverses
/// it. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/books/merge",
    tag = "Admin",
    operation_id = "merge_books",
    request_body = MergeBooksRequest,
    responses(
        (status = 200, description = "The books are merged.", body = MergeBooksResult),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No book has the source or target uuid; the body says which."),
        (status = 422, description = "The source and target are the same book."),
    ),
)]
pub(super) async fn post_merge_books(
    admin: AdminUser,
    State(state): State<AppState>,
    Json(req): Json<MergeBooksRequest>,
) -> Response {
    // Repeats the `AdminUser` gate of `rpc_merge_books` in `omnibus_frontend::rpc::books`;
    // changing one side's gate means changing the other.
    match db::merge_books(
        &state.pool,
        &req.source_uuid,
        &req.target_uuid,
        Some(admin.0.id),
    )
    .await
    {
        Ok(out) => Json(MergeBooksResult {
            merge_log_id: out.merge_log_id,
            target_uuid: out.target_uuid,
        })
        .into_response(),
        Err(e @ db::MergeError::BookNotFound(_)) => {
            (StatusCode::NOT_FOUND, e.to_string()).into_response()
        }
        Err(e @ db::MergeError::SameBook) => {
            (StatusCode::UNPROCESSABLE_ENTITY, e.to_string()).into_response()
        }
        Err(e) => internal("merge books", e),
    }
}

/// Undo a merge
///
/// Splits a merged book back into the two it was made from, and returns the restored
/// source book's uuid. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/books/merge/undo",
    tag = "Admin",
    operation_id = "undo_merge",
    request_body = UndoMergeRequest,
    responses(
        (status = 200, description = "The merge is undone.", body = UndoMergeResult),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No merge has that `merge_log_id`."),
        (status = 409, description = "The merge is already undone, or something changed since that undo can't settle, such as a later merge into the same book; the body says what."),
    ),
)]
pub(super) async fn post_undo_merge(
    _admin: AdminUser,
    State(state): State<AppState>,
    Json(req): Json<UndoMergeRequest>,
) -> Response {
    // Mirrors `rpc_undo_merge`, with the same gate-parity note as `post_merge_books`.
    match db::undo_merge(&state.pool, req.merge_log_id).await {
        Ok(uuid) => Json(UndoMergeResult {
            restored_uuid: uuid,
        })
        .into_response(),
        Err(e @ db::MergeError::LogNotFound) => {
            (StatusCode::NOT_FOUND, e.to_string()).into_response()
        }
        // Both are "the state moved on since the merge", which is a conflict
        // the caller can act on rather than an internal failure.
        Err(e @ (db::MergeError::AlreadyUndone | db::MergeError::UndoConflict(_))) => {
            (StatusCode::CONFLICT, e.to_string()).into_response()
        }
        Err(e) => internal("undo merge", e),
    }
}
