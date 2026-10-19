//! Bookmark REST handlers for the mobile client (`/api/bookmarks*`).
//!
//! Web clients use the `/api/rpc/bookmarks/*` server functions defined in
//! `omnibus_frontend::rpc`. One model serves both the audiobook player and the
//! reader — `position` is seconds-as-string or an EPUB CFI respectively.

use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, bookmarks::BookmarkError};
use omnibus_shared::{
    AnnotationOrderQuery, Bookmark, ClientStamped, CreateBookmark, UpdateBookmark,
};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Create a bookmark
///
/// Marks a place in a book: an EPUB CFI from the reader, or seconds from the audiobook
/// player. Mint a `client_id` on the device and the create is safe to repeat: sending the
/// same `client_id` again returns the bookmark the first create made, unchanged.
#[utoipa::path(
    post,
    path = "/api/bookmarks",
    tag = "Annotations",
    request_body = ClientStamped<CreateBookmark>,
    responses(
        (status = 200, description = "The bookmark.", body = Bookmark),
        (status = 400, description = "`book_uuid` or `position` is blank, a field is too long, `client_id` is blank, or `client_created_at` is negative."),
        (status = 404, description = "No book has that `book_uuid`."),
    ),
)]
pub(super) async fn post_bookmark(
    user: AuthUser,
    State(state): State<AppState>,
    Json(stamped): Json<ClientStamped<CreateBookmark>>,
) -> Response {
    if let Err(msg) = stamped.body.validate().and(stamped.validate_stamp()) {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::bookmarks::create_bookmark_at(
        &state.pool,
        user.id,
        &stamped.body,
        stamped.client_created_at,
    )
    .await
    {
        Ok(b) => Json(b).into_response(),
        Err(BookmarkError::BookNotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "book not found").into_response()
        }
        // NotFound on create means the just-inserted row couldn't be re-read —
        // a server invariant break, not a missing client resource. Surface 500.
        Err(e @ BookmarkError::NotFound) => internal("create_bookmark", e),
        Err(BookmarkError::Sqlx(e)) => internal("create_bookmark", e),
    }
}

/// List your bookmarks in a book
///
/// Each bookmark comes placed in the book: its spine index, chapter title and how far
/// through the book it sits. Returns up to 1,000, and an empty list for a uuid no book has.
#[utoipa::path(
    get,
    path = "/api/bookmarks/book/{book_uuid}",
    tag = "Annotations",
    params(("book_uuid" = String, Path, description = "The book's uuid."), AnnotationOrderQuery),
    responses((status = 200, description = "Your bookmarks in the book.", body = Vec<Bookmark>)),
)]
pub(super) async fn get_bookmarks(
    user: AuthUser,
    State(state): State<AppState>,
    Path(book_uuid): Path<String>,
    Query(order): Query<AnnotationOrderQuery>,
) -> Response {
    match db::bookmarks::list_bookmarks(&state.pool, user.id, &book_uuid, order.into()).await {
        Ok(list) => Json(list).into_response(),
        Err(BookmarkError::Sqlx(e)) => internal("list_bookmarks", e),
        Err(e) => internal("list_bookmarks", e),
    }
}

/// Resolve a `{id}` path segment to a numeric bookmark id.
///
/// Accepts either the server's row id or the uuid the creating device minted
/// (migration 0051), so an offline client can address a bookmark it created
/// but has not yet synced. See `highlights::resolve_id` for the full rationale.
async fn resolve_id(state: &AppState, user_id: i64, raw: &str) -> Result<i64, BookmarkError> {
    if let Ok(id) = raw.parse::<i64>() {
        return Ok(id);
    }
    db::bookmarks::bookmark_id_for_client_id(&state.pool, user_id, raw)
        .await?
        .ok_or(BookmarkError::NotFound)
}

/// Rename a bookmark
///
/// Replaces the bookmark's title. A null or absent `title` removes it.
#[utoipa::path(
    put,
    path = "/api/bookmarks/{id}",
    tag = "Annotations",
    params(("id" = String, Path, description = "The bookmark's id, or the `client_id` it was created with.")),
    request_body = UpdateBookmark,
    responses(
        (status = 204, description = "The title is saved."),
        (status = 400, description = "The title is over 512 characters."),
        (status = 404, description = "You have no bookmark with that id."),
    ),
)]
pub(super) async fn put_bookmark(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateBookmark>,
) -> Response {
    if let Err(msg) = body.validate() {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    let id = match resolve_id(&state, user.id, &id).await {
        Ok(id) => id,
        Err(BookmarkError::NotFound) => {
            return (axum::http::StatusCode::NOT_FOUND, "bookmark not found").into_response()
        }
        Err(e) => return internal("update_bookmark", e),
    };
    match db::bookmarks::update_bookmark(&state.pool, user.id, id, body.title.as_deref()).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(BookmarkError::NotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "bookmark not found").into_response()
        }
        Err(BookmarkError::Sqlx(e)) => internal("update_bookmark", e),
        Err(e) => internal("update_bookmark", e),
    }
}

/// Delete a bookmark
#[utoipa::path(
    delete,
    path = "/api/bookmarks/{id}",
    tag = "Annotations",
    params(("id" = String, Path, description = "The bookmark's id, or the `client_id` it was created with.")),
    responses(
        (status = 204, description = "The bookmark is deleted."),
        (status = 404, description = "You have no bookmark with that id."),
    ),
)]
pub(super) async fn delete_bookmark(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let id = match resolve_id(&state, user.id, &id).await {
        Ok(id) => id,
        Err(BookmarkError::NotFound) => {
            return (axum::http::StatusCode::NOT_FOUND, "bookmark not found").into_response()
        }
        Err(e) => return internal("delete_bookmark", e),
    };
    match db::bookmarks::delete_bookmark(&state.pool, user.id, id).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(BookmarkError::NotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "bookmark not found").into_response()
        }
        Err(BookmarkError::Sqlx(e)) => internal("delete_bookmark", e),
        Err(e) => internal("delete_bookmark", e),
    }
}

#[cfg(test)]
mod tests;
