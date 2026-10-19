//! Wire types for the admin book-merge surface (`/api/rpc/merge-books`
//! and the REST mirror `/api/books/merge`).

use serde::{Deserialize, Serialize};

/// Result of a successful merge: the audit-log id (the undo handle) and
/// the surviving book's uuid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct MergeBooksResult {
    pub merge_log_id: i64,
    pub target_uuid: String,
}

/// Request body for `POST /api/books/merge`: merge the source book into the target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct MergeBooksRequest {
    pub source_uuid: String,
    pub target_uuid: String,
}

/// Request body for `POST /api/books/merge/undo`: the `merge_log` id to reverse.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct UndoMergeRequest {
    pub merge_log_id: i64,
}

/// Result of a successful unmerge: the restored (source) book's uuid.
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
