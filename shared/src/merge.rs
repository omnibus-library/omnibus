//! Wire types for the admin book-merge surface (`/api/rpc/merge-books`
//! and the REST mirror `/api/books/merge`).

use serde::{Deserialize, Serialize};

/// The result of a merge: the id that undoes it, and the uuid of the book that remains.
/// Pass `merge_log_id` to `POST /api/books/merge/undo` to reverse the merge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct MergeBooksResult {
    pub merge_log_id: i64,
    pub target_uuid: String,
}

/// The two books `POST /api/books/merge` merges. The source book folds into the target
/// and disappears.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct MergeBooksRequest {
    pub source_uuid: String,
    pub target_uuid: String,
}

/// The merge `POST /api/books/merge/undo` reverses, by the `merge_log_id` the merge
/// returned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct UndoMergeRequest {
    pub merge_log_id: i64,
}

/// The uuid of the source book that undoing a merge restored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct UndoMergeResult {
    pub restored_uuid: String,
}

/// The search for a book to merge with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct MergeCandidatesQuery {
    /// Free text, optionally with `author:`, `series:`, `tag:` and `genre:` terms. At most
    /// 1024 bytes.
    pub q: String,
}
