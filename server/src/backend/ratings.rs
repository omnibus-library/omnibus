//! Star-rating REST handlers (`/api/ratings*`), the stars-only view of a
//! review: set, get, and clear a half-star rating (`0.5..=5.0`) per
//! `(user, book)`, with the range and half-step validated at the boundary so an
//! invalid value returns 400. Installed iOS and Android builds still call them,
//! including when they replay writes queued offline, so the routes stay. Each
//! is `#[deprecated]`, which marks it so in the spec; `/api/reviews` replaces them.

use axum::{
    extract::{Path, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, ratings::RatingError};
use omnibus_shared::{AttributedRating, RatingRecord, RatingUpdate};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Rate a book
///
/// Sets your star rating for a book, from 0.5 to 5 in half-star steps, replacing any rating
/// you gave it before. Any review text and notes stay. Use `PATCH /api/reviews/{uuid}`.
#[utoipa::path(
    post,
    path = "/api/ratings",
    tag = "Ratings",
    request_body = RatingUpdate,
    responses(
        (status = 200, description = "Your rating as stored.", body = RatingRecord),
        (status = 400, description = "`book_uuid` is blank, or `stars` is outside 0.5 to 5 or not a whole number of half stars."),
        (status = 404, description = "No book has that `book_uuid`."),
    ),
)]
#[deprecated = "use the /api/reviews routes"]
pub(super) async fn post_rating(
    user: AuthUser,
    State(state): State<AppState>,
    Json(update): Json<RatingUpdate>,
) -> Response {
    if let Err(msg) = update.validate() {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::ratings::set_rating(&state.pool, user.id, &update).await {
        Ok(rec) => Json(rec).into_response(),
        Err(RatingError::BookNotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "book not found").into_response()
        }
        Err(RatingError::Sqlx(e)) => internal("set_rating", e),
    }
}

/// Get your rating for a book
///
/// The body is `null` when you haven't rated the book, or no book has the uuid. Use
/// `GET /api/reviews/{uuid}`.
#[utoipa::path(
    get,
    path = "/api/ratings/{uuid}",
    tag = "Ratings",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 200, description = "Your rating, or `null`.", body = Option<RatingRecord>)),
)]
#[deprecated = "use the /api/reviews routes"]
pub(super) async fn get_rating(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::ratings::get_rating(&state.pool, user.id, &uuid).await {
        Ok(rec) => Json(rec).into_response(),
        Err(e) => internal("get_rating", e),
    }
}

/// List other users' ratings of a book
///
/// Every other user's rating of the book, with their name, most recently rated first.
/// Returns up to 1,000, and an empty list for a uuid no book has. Use
/// `GET /api/reviews/{uuid}`.
#[utoipa::path(
    get,
    path = "/api/ratings/others/{uuid}",
    tag = "Ratings",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 200, description = "Other users' ratings, most recently rated first.", body = Vec<AttributedRating>)),
)]
#[deprecated = "use the /api/reviews routes"]
pub(super) async fn get_other_ratings(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::ratings::list_other_ratings(&state.pool, user.id, &uuid).await {
        Ok(ratings) => Json(ratings).into_response(),
        Err(e) => internal("get_other_ratings", e),
    }
}

/// Remove your rating of a book
///
/// Clears only the stars: any review text and notes stay. Succeeds whether or not you had
/// rated the book. Use `PATCH /api/reviews/{uuid}` with `"stars": null`.
#[utoipa::path(
    delete,
    path = "/api/ratings/{uuid}",
    tag = "Ratings",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 204, description = "You have no rating for the book.")),
)]
#[deprecated = "use the /api/reviews routes"]
pub(super) async fn delete_rating(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::ratings::delete_rating(&state.pool, user.id, &uuid).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => internal("delete_rating", e),
    }
}

#[cfg(test)]
mod tests;
