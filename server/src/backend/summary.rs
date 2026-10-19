//! On-demand book-summary fetch REST handlers (mobile-facing); web hits the
//! analogous `/api/rpc/ebook/summary/*` server functions in
//! `omnibus_frontend::rpc::summary`.

use axum::{
    extract::{Path, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db};
use omnibus_shared::summary::{FetchSummaryBody, SummarySource};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Fetch a book's summary
///
/// Asks one provider for a summary of the book and returns its text, or `null` when that
/// provider has none (try the next source from `GET /api/summary/sources`). An unknown
/// uuid also answers `null`. Nothing is saved. A provider that can't be reached is a 500.
/// Needs the edit permission.
#[utoipa::path(
    post,
    path = "/api/ebooks/{uuid}/summary/fetch",
    tag = "Metadata",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body = FetchSummaryBody,
    responses(
        (status = 200, description = "The summary text, or `null`.", body = Option<String>),
        (status = 403, description = "You lack the edit permission."),
    ),
)]
pub(super) async fn post_ebook_summary_fetch(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(body): Json<FetchSummaryBody>,
) -> Response {
    if !user.is_admin && !user.can_edit {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "edit permission required",
        )
            .into_response();
    }
    match db::fetch_summary(&state.pool, &uuid, body.source).await {
        Ok(text) => Json(text).into_response(),
        Err(e) => internal("fetch summary", e),
    }
}

/// List the summary sources
///
/// The providers to ask for a summary, in the order to ask them: Hardcover when the server
/// has a Hardcover key, then Google Books, then Open Library only when the server has
/// neither a Hardcover nor a Google Books key.
#[utoipa::path(
    get,
    path = "/api/summary/sources",
    tag = "Metadata",
    responses((status = 200, description = "The sources, first to ask first.", body = Vec<SummarySource>)),
)]
pub(super) async fn get_summary_sources(
    _user: AuthUser,
    State(state): State<AppState>,
) -> Response {
    match db::summary_source_plan(&state.pool).await {
        Ok(sources) => Json(sources).into_response(),
        Err(e) => internal("summary source plan", e),
    }
}

#[cfg(test)]
mod tests;
