//! `/api/series/*` handlers.
//!
//! Cookie-gated reads returning the series browse-all index, per-series
//! detail (books in series order, primary author, accent), and the caller's
//! own progress through each series.
//! Mounted on the mobile REST router in [`super::rest_router`].

use axum::{
    extract::{Path, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db};
use omnibus_shared::{SeriesDetail, SeriesReading, SeriesSummary};

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

/// List your progress through each series
///
/// For each series whose books you have opened or marked: how many you have finished, how
/// many you are reading, and when you last read one. Series you haven't started are left
/// out.
#[utoipa::path(
    get,
    path = "/api/series/reading",
    tag = "Discovery",
    responses((status = 200, description = "Your progress, one row per series.", body = Vec<SeriesReading>)),
)]
pub(super) async fn get_series_reading(user: AuthUser, State(state): State<AppState>) -> Response {
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(e) => return internal("read settings", e),
    };
    let paths = db::collect_paths(
        settings.ebook_library_path.as_deref(),
        settings.audiobook_library_path.as_deref(),
    );
    match db::series_reading(&state.pool, user.id, &paths).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => internal("series reading", e),
    }
}

/// Get a series
///
/// One series and its books, in series order. `reading` holds your own status and
/// position on each of those books you have opened or marked.
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
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match db::get_series(&state.pool, id).await {
        Ok(Some(mut series)) => {
            match db::book_reading(&state.pool, user.id, &db::book_uuids(&series.books)).await {
                Ok(reading) => series.reading = reading,
                Err(e) => return internal("series book reading", e),
            }
            Json(series).into_response()
        }
        Ok(None) => axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal("read series", error),
    }
}

#[cfg(test)]
mod tests;
