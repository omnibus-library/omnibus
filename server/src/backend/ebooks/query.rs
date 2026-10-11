//! Query-string decoding for `GET /api/ebooks`: the keyset cursor, the
//! `?formats=` list, and the `?filter=` clauses. Used by the listing handler.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use omnibus_db as db;
use omnibus_shared::ViewFilters;

use super::EbooksQuery;

/// Split the `?formats=` wire value into filter entries, dropping empties.
pub(super) fn parse_formats(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// The request's filters: the `?filter=` clauses plus the legacy `?formats=`
/// list as an include-format clause. `Err` carries the reason it was rejected.
pub(super) fn request_filters(q: &EbooksQuery) -> Result<ViewFilters, String> {
    let mut filters = match q.filter.as_deref() {
        Some(raw) => ViewFilters::from_query_param(raw)?,
        None => ViewFilters::default(),
    };
    filters.formats = q.formats.as_deref().map(parse_formats).unwrap_or_default();
    filters.validate()?;
    Ok(filters)
}

/// Client-input error for a malformed or under-specified keyset-page
/// request. Kept lean rather than a full `Response` — clippy's
/// `result_large_err` — with the caller rendering the actual 400 (mirrors
/// `parse_thumb_size` in `covers.rs`).
pub(super) enum CursorRequestError {
    RequiresSortAndDir,
    Malformed,
}

impl CursorRequestError {
    pub(super) fn into_response(self) -> Response {
        let msg = match self {
            CursorRequestError::RequiresSortAndDir => "cursor requires sort and dir",
            CursorRequestError::Malformed => "malformed cursor",
        };
        (StatusCode::BAD_REQUEST, msg).into_response()
    }
}

/// Decode `q.cursor` relative to `q.sort`/`q.dir`. A cursor without an
/// explicit `sort` **and** `dir`, or a malformed cursor, is a 400 rather than
/// a silently mis-positioned page or a 500 — returned as `Err` for the caller
/// to short-circuit on.
pub(super) fn decode_page_cursor(
    q: &EbooksQuery,
) -> Result<Option<db::PageCursor>, CursorRequestError> {
    if q.cursor.is_some() && (q.sort.is_none() || q.dir.is_none()) {
        return Err(CursorRequestError::RequiresSortAndDir);
    }
    match q.cursor.as_deref() {
        Some(c) => db::PageCursor::decode(c)
            .map(Some)
            .map_err(|_| CursorRequestError::Malformed),
        None => Ok(None),
    }
}
