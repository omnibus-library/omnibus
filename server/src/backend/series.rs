//! `/api/series/*` handlers.
//!
//! Cookie-gated reads returning the series browse-all index, per-series
//! detail (books in series order, primary author, accent), and the caller's
//! own progress through each series.
//! Mounted on the mobile REST router in [`super::rest_router`].

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, series_progress::SeriesProgressError};
use omnibus_shared::{SeriesDetail, SeriesInProgress, SeriesReading, SeriesSummary};

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

/// List the series you are partway through
///
/// The series you have started and not finished, for a home page: at least two books in the
/// library, at least one you are reading or have finished, and at least one not finished.
/// Series you hid are left out; starting a book of one you hadn't started brings it back.
/// Most recently read first, then by name. Each carries its books and your state on them as
/// `GET /api/series/{id}` does, plus the book to open next.
#[utoipa::path(
    get,
    path = "/api/series/in-progress",
    tag = "Discovery",
    responses((status = 200, description = "Your series in progress.", body = Vec<SeriesInProgress>)),
)]
pub(super) async fn get_series_in_progress(
    user: AuthUser,
    State(state): State<AppState>,
) -> Response {
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(e) => return internal("read settings", e),
    };
    let paths = db::collect_paths(
        settings.ebook_library_path.as_deref(),
        settings.audiobook_library_path.as_deref(),
    );
    match db::series_progress::in_progress(&state.pool, user.id, &paths).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => internal("series in progress", e),
    }
}

/// Get a series
///
/// One series and its books, in series order. `reading` holds your own status and
/// position on each of those books you have opened or marked, and `hidden_from_home`
/// whether you hid the series from the home page.
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
            match db::series_progress::is_hidden(&state.pool, user.id, id).await {
                Ok(hidden) => series.hidden_from_home = hidden,
                Err(e) => return internal("series hide", e),
            }
            Json(series).into_response()
        }
        Ok(None) => axum::http::StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal("read series", error),
    }
}

/// Hide a series from home
///
/// Keeps the series off your home page's series in progress. It stays in your library and
/// comes back there when you start a book of it that you hadn't started. Hiding a hidden
/// series changes nothing.
#[utoipa::path(
    put,
    path = "/api/series/{id}/hide",
    tag = "Discovery",
    params(("id" = i64, Path, description = "The series' id.")),
    responses(
        (status = 204, description = "The series is hidden from your home page."),
        (status = 404, description = "No series has that id."),
    ),
)]
pub(super) async fn put_series_hide(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    hide_response(
        db::series_progress::hide(&state.pool, user.id, id).await,
        "hide series",
    )
}

/// Show a series on home again
///
/// Lifts your hide, so the series can appear in your home page's series in progress again.
/// Showing a series that isn't hidden changes nothing.
#[utoipa::path(
    delete,
    path = "/api/series/{id}/hide",
    tag = "Discovery",
    params(("id" = i64, Path, description = "The series' id.")),
    responses(
        (status = 204, description = "The series is no longer hidden from your home page."),
        (status = 404, description = "No series has that id."),
    ),
)]
pub(super) async fn delete_series_hide(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    hide_response(
        db::series_progress::unhide(&state.pool, user.id, id).await,
        "show series",
    )
}

/// The response both hide routes share: 204, or 404 for an unknown series.
fn hide_response(result: Result<(), SeriesProgressError>, context: &'static str) -> Response {
    match result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(SeriesProgressError::SeriesNotFound) => {
            (StatusCode::NOT_FOUND, "No series has that id.").into_response()
        }
        Err(e) => internal(context, e),
    }
}

#[cfg(test)]
mod tests;
