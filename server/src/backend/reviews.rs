//! Book review REST handlers (`/api/reviews/{uuid}`): read a book's reviews,
//! patch your own field by field, delete it. A patch is validated at the
//! boundary so bad stars or oversized text return 400. Private notes reach
//! only their author; `db::reviews` enforces that by type. Web clients use
//! the `/api/rpc/reviews/*` server functions in `omnibus_frontend::rpc`.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, reviews::ReviewError};
use omnibus_shared::{BookReviews, Review, ReviewPatch};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Get a book's reviews
///
/// Your own review, private notes included; every other reader's review with stars or
/// text, without their notes; and a summary of every reader's stars once at least two
/// have rated the book.
#[utoipa::path(
    get,
    path = "/api/reviews/{uuid}",
    tag = "Reviews",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The book's reviews.", body = BookReviews),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn get_book_reviews(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::reviews::get_book_reviews(&state.pool, user.id, &uuid).await {
        Ok(reviews) => Json(reviews).into_response(),
        Err(ReviewError::BookNotFound) => (StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(ReviewError::Sqlx(e)) => internal("get_book_reviews", e),
    }
}

/// Change your review of a book
///
/// Creates the review on first write. Only the fields you send change: leave a field out
/// to keep it, send it as null to clear it. Stars, text and notes are independent, so
/// clearing the stars keeps your text. The body is `null` when the change left the review
/// with no stars, text or notes, which deletes it.
#[utoipa::path(
    patch,
    path = "/api/reviews/{uuid}",
    tag = "Reviews",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body = ReviewPatch,
    responses(
        (status = 200, description = "Your review as stored, or `null` if it is now empty and deleted.", body = Option<Review>),
        (status = 400, description = "`stars` is outside 0.5 to 5 or not a whole number of half stars, or `body_md` or `notes_md` is over 65,536 bytes."),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn patch_review(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(patch): Json<ReviewPatch>,
) -> Response {
    if let Err(msg) = patch.validate() {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::reviews::update_review(&state.pool, user.id, &uuid, &patch).await {
        Ok(review) => Json(review).into_response(),
        Err(ReviewError::BookNotFound) => (StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(ReviewError::Sqlx(e)) => internal("patch_review", e),
    }
}

/// Delete your review of a book
///
/// Removes your stars, text and private notes together. Succeeds whether or not you had
/// reviewed the book.
#[utoipa::path(
    delete,
    path = "/api/reviews/{uuid}",
    tag = "Reviews",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 204, description = "You have no review of the book.")),
)]
pub(super) async fn delete_review(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::reviews::delete_review(&state.pool, user.id, &uuid).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => internal("delete_review", e),
    }
}

#[cfg(test)]
mod tests;
