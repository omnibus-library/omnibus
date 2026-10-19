//! `GET /api/tags` handler.
//!
//! Cookie-gated read returning the tag cloud (tag name + weight) for the
//! configured library. Powers the native iOS tag browser and the tag
//! autocomplete pools.

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db};
use omnibus_shared::TagWeight;

use super::{internal, AppState};
use crate::auth::AuthUser;

/// List tags
///
/// Every tag on a book, with the number of books carrying it, most-used first. Stops at
/// the 500 most-used tags.
#[utoipa::path(
    get,
    path = "/api/tags",
    tag = "Discovery",
    responses((status = 200, description = "The tags.", body = Vec<TagWeight>)),
)]
pub(super) async fn get_tags(_user: AuthUser, State(state): State<AppState>) -> Response {
    match db::get_tag_cloud(&state.pool).await {
        Ok(tags) => Json(tags).into_response(),
        Err(error) => internal("read tags", error),
    }
}

#[cfg(test)]
mod tests;
