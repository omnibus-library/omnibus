//! `GET /api/genres` handler.
//!
//! Cookie-gated read returning the genre cloud (genre name + book count) for
//! the configured library. Mirrors `/api/tags`; backs the genre chip-editor's
//! autocomplete pool on the native clients.

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db};
use omnibus_shared::GenreWeight;

use super::{internal, AppState};
use crate::auth::AuthUser;

/// List genres
///
/// Every genre assigned to a book, with the number of books carrying it, most-used
/// first. Stops at the 500 most-used genres.
#[utoipa::path(
    get,
    path = "/api/genres",
    tag = "Discovery",
    responses((status = 200, description = "The genres.", body = Vec<GenreWeight>)),
)]
pub(super) async fn get_genres(_user: AuthUser, State(state): State<AppState>) -> Response {
    match db::get_genre_cloud(&state.pool).await {
        Ok(genres) => Json(genres).into_response(),
        Err(error) => internal("read genres", error),
    }
}

#[cfg(test)]
mod tests;
