//! `GET /api/books/{uuid}/cover/palette`: gradient pairs drawn from a book's cover,
//! for the quote card's Gradient row. Resolves the cover the same way
//! [`super::covers::get_cover`] does (an override cover wins), then runs the palette
//! extraction off the async runtime since the image decode is CPU-bound.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db};
use omnibus_shared::CoverPalette;

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Get a cover's gradient pairs
///
/// Up to four gradient pairs drawn from the book's cover, darkest first. Each `ink` reads
/// at 4.5:1 or better on both stops of its pair. A cover too plain to yield a pair gives
/// an empty list.
#[utoipa::path(
    get,
    path = "/api/books/{uuid}/cover/palette",
    tag = "Covers",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The cover's gradient pairs.", body = CoverPalette),
        (status = 404, description = "No book has that uuid, or the book has no cover."),
    ),
)]
pub(super) async fn get_cover_palette(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    let id = match db::resolve_book_id_by_uuid(&state.pool, &uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    };
    let bytes = match db::get_cover(&state.pool, id).await {
        Ok(Some((_mime, bytes))) => bytes,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return internal("get_cover", e),
    };
    match tokio::task::spawn_blocking(move || db::ebook::extract_cover_palette(&bytes)).await {
        Ok(pairs) => Json(CoverPalette { pairs }).into_response(),
        Err(e) => internal("extract_cover_palette", e),
    }
}

#[cfg(test)]
mod tests;
