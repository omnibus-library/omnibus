//! `/api/series/*` handlers.
//!
//! Cookie-gated reads returning the series browse-all index and
//! per-series detail (books in series order, primary author, accent).
//! Mounted on the mobile REST router in [`super::rest_router`].

use axum::{
    extract::{Path, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db};
use omnibus_shared::{SeriesDetail, SeriesSummary};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// List series
///
/// Every series with a book in the library, by name, each with a book count, the first
/// book's first author and an accent color. Stops at 10,000 series.
#[utoipa::path(
    get,
    path = "/api/series",
    tag = "Discovery",
    operation_id = "list_series",
    responses((status = 200, description = "The series.", body = Vec<SeriesSummary>)),
)]
pub(super) async fn get_series(_user: AuthUser, State(state): State<AppState>) -> Response {
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(e) => return internal("read settings", e),
    };
    let paths = db::collect_paths(
        settings.ebook_library_path.as_deref(),
        settings.audiobook_library_path.as_deref(),
    );
    match db::list_series(&state.pool, &paths).await {
        Ok(series) => Json(series).into_response(),
        Err(e) => internal("list series", e),
    }
}

/// Get a series
///
/// One series and its books, in series order.
#[utoipa::path(
    get,
    path = "/api/series/{id}",
    tag = "Discovery",
    params(("id" = i64, Path, description = "The series' id.")),
    responses(
        (status = 200, description = "The series.", body = SeriesDetail),
        (status = 404, description = "No series has that id."),
    ),
)]
pub(super) async fn get_series_by_id(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match db::get_series(&state.pool, id).await {
        Ok(Some(series)) => Json(series).into_response(),
        Ok(None) => axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal("read series", error),
    }
}

#[cfg(test)]
mod tests;
