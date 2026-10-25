//! Highlight annotation REST handlers for the mobile client (`/api/highlights*`).
//!
//! Web clients use the `/api/rpc/highlights/*` server functions defined in
//! `omnibus_frontend::rpc`.

use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, annotations::HighlightError};
use omnibus_shared::{
    AnnotationOrderQuery, ClientStamped, CreateHighlight, Highlight, UpdateHighlightColor,
    UpdateHighlightNote,
};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Create a highlight
///
/// Highlights a passage of a book. Mint a `client_id` on the device and the create is safe
/// to repeat: sending the same `client_id` again returns the highlight the first create
/// made, unchanged.
#[utoipa::path(
    post,
    path = "/api/highlights",
    tag = "Annotations",
    request_body = ClientStamped<CreateHighlight>,
    responses(
        (status = 200, description = "The highlight.", body = Highlight),
        (status = 400, description = "`book_uuid` or `epub_cfi_range` is blank, a field is too long, `client_id` is blank, or `client_created_at` is negative."),
        (status = 404, description = "No book has that `book_uuid`."),
        (status = 410, description = "That `client_id` was deleted; a delete is final, so repeating the create can never succeed."),
    ),
)]
pub(super) async fn post_highlight(
    user: AuthUser,
    State(state): State<AppState>,
    Json(stamped): Json<ClientStamped<CreateHighlight>>,
) -> Response {
    if let Err(msg) = stamped.body.validate().and(stamped.validate_stamp()) {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::annotations::create_highlight_at(
        &state.pool,
        user.id,
        &stamped.body,
        stamped.client_created_at,
    )
    .await
    {
        Ok(h) => {
            // Kobo down-sync: convert the fresh row in the background so it
            // reaches the device on its next sync. The worker handle lets a
            // cold KEPUB cache request its own conversion instead of leaving
            // the row permanently unresolved.
            db::annotations::spawn_kobo_downsync(
                state.pool.clone(),
                Some(state.worker().clone()),
                user.id,
                h.book_uuid.clone(),
            );
            Json(h).into_response()
        }
        Err(HighlightError::BookNotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "book not found").into_response()
        }
        Err(HighlightError::Gone) => {
            (axum::http::StatusCode::GONE, "highlight was deleted").into_response()
        }
        // NotFound on create means the just-inserted row couldn't be re-read —
        // a server invariant break, not a missing client resource. Surface 500.
        Err(e @ HighlightError::NotFound) => internal("create_highlight", e),
        Err(HighlightError::Sqlx(e)) => internal("create_highlight", e),
    }
}

/// List your highlights in a book
///
/// Each highlight comes placed in the book: its spine index, chapter title and how far
/// through the book it sits. Returns up to 1,000, and an empty list for a uuid no book has.
#[utoipa::path(
    get,
    path = "/api/highlights/book/{book_uuid}",
    tag = "Annotations",
    params(("book_uuid" = String, Path, description = "The book's uuid."), AnnotationOrderQuery),
    responses((status = 200, description = "Your highlights in the book.", body = Vec<Highlight>)),
)]
pub(super) async fn get_highlights(
    user: AuthUser,
    State(state): State<AppState>,
    Path(book_uuid): Path<String>,
    Query(order): Query<AnnotationOrderQuery>,
) -> Response {
    match db::annotations::list_highlights(&state.pool, user.id, &book_uuid, order.into()).await {
        Ok(list) => Json(list).into_response(),
        Err(HighlightError::Sqlx(e)) => internal("list_highlights", e),
        Err(e) => internal("list_highlights", e),
    }
}

/// Resolve a `{id}` path segment to a numeric highlight id: either the server's own
/// row id or the uuid the creating device minted. An offline client queues edits and
/// deletes against its own uuid before it learns the row id, and replaying them must
/// land on the same annotation. A uuid can't parse as `i64`, so the two namespaces
/// can't collide.
async fn resolve_id(state: &AppState, user_id: i64, raw: &str) -> Result<i64, HighlightError> {
    if let Ok(id) = raw.parse::<i64>() {
        return Ok(id);
    }
    db::annotations::highlight_id_for_client_id(&state.pool, user_id, raw)
        .await?
        .ok_or(HighlightError::NotFound)
}

/// Change a highlight's color
#[utoipa::path(
    patch,
    path = "/api/highlights/{id}/color",
    tag = "Annotations",
    params(("id" = String, Path, description = "The highlight's id, or the `client_id` it was created with.")),
    request_body = UpdateHighlightColor,
    responses(
        (status = 204, description = "The color is changed."),
        (status = 404, description = "You have no highlight with that id."),
    ),
)]
pub(super) async fn patch_highlight_color(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateHighlightColor>,
) -> Response {
    let id = match resolve_id(&state, user.id, &id).await {
        Ok(id) => id,
        Err(HighlightError::NotFound) => {
            return (axum::http::StatusCode::NOT_FOUND, "highlight not found").into_response()
        }
        Err(e) => return internal("update_highlight_color", e),
    };
    match db::annotations::update_highlight_color(&state.pool, user.id, id, body.color).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(HighlightError::NotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "highlight not found").into_response()
        }
        Err(HighlightError::Sqlx(e)) => internal("update_highlight_color", e),
        Err(e) => internal("update_highlight_color", e),
    }
}

/// Set a highlight's note
///
/// Replaces the note. A null or absent `note` removes it.
#[utoipa::path(
    patch,
    path = "/api/highlights/{id}/note",
    tag = "Annotations",
    params(("id" = String, Path, description = "The highlight's id, or the `client_id` it was created with.")),
    request_body = UpdateHighlightNote,
    responses(
        (status = 204, description = "The note is saved."),
        (status = 400, description = "The note is over 4,096 characters."),
        (status = 404, description = "You have no highlight with that id."),
    ),
)]
pub(super) async fn patch_highlight_note(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateHighlightNote>,
) -> Response {
    if let Err(msg) = body.validate() {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    let id = match resolve_id(&state, user.id, &id).await {
        Ok(id) => id,
        Err(HighlightError::NotFound) => {
            return (axum::http::StatusCode::NOT_FOUND, "highlight not found").into_response()
        }
        Err(e) => return internal("update_highlight_note", e),
    };
    match db::annotations::update_highlight_note(&state.pool, user.id, id, body.note.as_deref())
        .await
    {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(HighlightError::NotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "highlight not found").into_response()
        }
        Err(HighlightError::Sqlx(e)) => internal("update_highlight_note", e),
        Err(e) => internal("update_highlight_note", e),
    }
}

/// Delete a highlight
#[utoipa::path(
    delete,
    path = "/api/highlights/{id}",
    tag = "Annotations",
    params(("id" = String, Path, description = "The highlight's id, or the `client_id` it was created with.")),
    responses(
        (status = 204, description = "The highlight is deleted."),
        (status = 404, description = "You have no highlight with that id."),
    ),
)]
pub(super) async fn delete_highlight(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let id = match resolve_id(&state, user.id, &id).await {
        Ok(id) => id,
        Err(HighlightError::NotFound) => {
            return (axum::http::StatusCode::NOT_FOUND, "highlight not found").into_response()
        }
        Err(e) => return internal("delete_highlight", e),
    };
    match db::annotations::delete_highlight(&state.pool, user.id, id).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(HighlightError::NotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "highlight not found").into_response()
        }
        Err(HighlightError::Sqlx(e)) => internal("delete_highlight", e),
        Err(e) => internal("delete_highlight", e),
    }
}

#[cfg(test)]
mod tests;
