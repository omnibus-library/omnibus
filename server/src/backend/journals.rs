//! Public per-book journal REST handlers for the mobile client
//! (`/api/journals*`): create, list, edit, and delete free-form markdown notes
//! on a book. Entries are public, but edit/delete are owner-scoped (404 for a
//! non-owner, same as a missing row). Bodies are validated at the boundary and
//! rendered to sanitized HTML; web clients use the `/api/rpc/journals/*` RPCs.

use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, journals::JournalError};
use omnibus_shared::{
    ClientStamped, CreateJournalEntry, FileBytes, JournalEntry, JournalImageForm,
    JournalImageUpload, UpdateJournalEntry, BODY_MAX_LEN,
};

use super::{image_upload, internal, AppState};
use crate::auth::{AuthUser, MediaAuthUser};

/// Create a journal entry
///
/// Writes a markdown entry about a book. A published entry, the default, is visible to
/// every user under your name; a `draft` only to you. Mint a `client_id` on the device and
/// the create is safe to repeat: sending the same `client_id` again returns the entry the
/// first create made, unchanged.
#[utoipa::path(
    post,
    path = "/api/journals",
    tag = "Journals",
    request_body = ClientStamped<CreateJournalEntry>,
    responses(
        (status = 200, description = "The entry, with its markdown rendered to HTML.", body = JournalEntry),
        (status = 400, description = "`book_uuid` or `body_md` is blank, `body_md` is over 65,536 bytes, `progress` is over 100, `client_id` is blank or too long, or `client_created_at` is negative."),
        (status = 404, description = "No book has that `book_uuid`."),
    ),
)]
pub(super) async fn post_journal(
    user: AuthUser,
    State(state): State<AppState>,
    Json(stamped): Json<ClientStamped<CreateJournalEntry>>,
) -> Response {
    if let Err(msg) = stamped.body.validate().and(stamped.validate_stamp()) {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::journals::create_journal_entry_at(
        &state.pool,
        user.id,
        &stamped.body,
        stamped.client_created_at,
    )
    .await
    {
        Ok(entry) => Json(entry).into_response(),
        Err(JournalError::BookNotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "book not found").into_response()
        }
        Err(e @ JournalError::NotFound) => internal("create_journal_entry", e),
        Err(JournalError::Sqlx(e)) => internal("create_journal_entry", e),
    }
}

/// List a book's journal entries
///
/// Every user's published entries for the book, plus your own drafts, newest first. Returns
/// up to 1,000, and an empty list for a uuid no book has.
#[utoipa::path(
    get,
    path = "/api/journals/book/{book_uuid}",
    tag = "Journals",
    params(("book_uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 200, description = "The book's entries.", body = Vec<JournalEntry>)),
)]
pub(super) async fn get_journal_entries(
    user: AuthUser,
    State(state): State<AppState>,
    Path(book_uuid): Path<String>,
) -> Response {
    match db::journals::list_journal_entries(&state.pool, user.id, &book_uuid).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => internal("list_journal_entries", e),
    }
}

/// Resolve a `{id}` path segment to a numeric entry id.
///
/// Accepts either the server's row id or the uuid the composing device minted
/// (migration 0051), so an offline client can edit or delete an entry it wrote
/// but has not yet synced. See `highlights::resolve_id` for the full rationale.
async fn resolve_id(state: &AppState, user_id: i64, raw: &str) -> Result<i64, JournalError> {
    if let Ok(id) = raw.parse::<i64>() {
        return Ok(id);
    }
    db::journals::journal_id_for_client_id(&state.pool, user_id, raw)
        .await?
        .ok_or(JournalError::NotFound)
}

/// Edit a journal entry
///
/// Replaces the body and progress of one of your entries. Send `status` to publish a draft
/// or turn an entry back into one; leave it out to keep the status. An uploaded image the
/// old body showed and no entry shows any more is deleted.
#[utoipa::path(
    patch,
    path = "/api/journals/{id}",
    tag = "Journals",
    params(("id" = String, Path, description = "The entry's id, or the `client_id` it was created with.")),
    request_body = UpdateJournalEntry,
    responses(
        (status = 200, description = "The entry as saved.", body = JournalEntry),
        (status = 400, description = "`body_md` is blank or over 65,536 bytes, or `progress` is over 100."),
        (status = 404, description = "You have no entry with that id. Another user's entry answers the same."),
    ),
)]
pub(super) async fn patch_journal(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateJournalEntry>,
) -> Response {
    if let Err(msg) = input.validate() {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    let id = match resolve_id(&state, user.id, &id).await {
        Ok(id) => id,
        Err(JournalError::NotFound) => {
            return (axum::http::StatusCode::NOT_FOUND, "journal entry not found").into_response()
        }
        Err(e) => return internal("update_journal_entry", e),
    };
    match db::journals::update_journal_entry(&state.pool, user.id, id, &input).await {
        Ok(entry) => Json(entry).into_response(),
        Err(JournalError::NotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "journal entry not found").into_response()
        }
        Err(e @ JournalError::BookNotFound) => internal("update_journal_entry", e),
        Err(JournalError::Sqlx(e)) => internal("update_journal_entry", e),
    }
}

/// Preview journal markdown
///
/// Renders markdown to HTML exactly as a saved entry's `body_html` is rendered, so a
/// composer can show a preview. The request body is the markdown as a JSON string, and the
/// response the sanitized HTML as a JSON string.
#[utoipa::path(
    post,
    path = "/api/journals/preview",
    tag = "Journals",
    request_body(content = String, content_type = "application/json", description = "The markdown, as a JSON string."),
    responses(
        (status = 200, description = "The rendered HTML, as a JSON string.", body = String, content_type = "application/json"),
        (status = 400, description = "The markdown is over 65,536 bytes."),
    ),
)]
pub(super) async fn post_journal_preview(_user: AuthUser, Json(body_md): Json<String>) -> Response {
    // The cap stops an authenticated client driving unbounded markdown and sanitize work.
    if body_md.len() > BODY_MAX_LEN {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            format!("journal entry must be {BODY_MAX_LEN} bytes or fewer"),
        )
            .into_response();
    }
    Json(db::journals::markdown::render(&body_md)).into_response()
}

/// Upload a journal image
///
/// Stores an image to embed in a journal entry and returns its URL. Put the URL in the
/// entry's markdown as `![caption](url)`.
#[utoipa::path(
    post,
    path = "/api/journals/images",
    tag = "Journals",
    request_body(content = inline(JournalImageForm), content_type = "multipart/form-data"),
    responses(
        (status = 200, description = "The stored image's URL.", body = JournalImageUpload),
        (status = 400, description = "The form has no `image` part, or the part's `Content-Type` isn't an image type, is SVG, or the image is over 10 MiB."),
        (status = 415, description = "The bytes aren't a JPEG, PNG, GIF or WebP image."),
    ),
)]
pub(super) async fn post_journal_image(
    _user: AuthUser,
    mut multipart: axum::extract::Multipart,
) -> Response {
    let (mime, bytes) = match image_upload::extract_validated_image(&mut multipart, "image").await {
        Ok(pair) => pair,
        Err(response) => return response,
    };
    // Sync `std::fs` write — run on the blocking pool.
    match tokio::task::spawn_blocking(move || {
        db::journal_images::write_journal_image(&mime, &bytes)
    })
    .await
    {
        Ok(Ok(name)) => Json(JournalImageUpload {
            url: format!("{}{name}", db::journals::markdown::IMAGE_URL_PREFIX),
        })
        .into_response(),
        Ok(Err(e)) => internal("write_journal_image", e),
        Err(e) => internal("spawn_blocking(write_journal_image)", e),
    }
}

/// Get a journal image
///
/// An image uploaded for a journal entry, by the name at the end of its URL. A name never
/// points at different bytes, so the response may be cached for a year.
#[utoipa::path(
    get,
    path = "/api/journals/images/{name}",
    tag = "Journals",
    security(("bearer" = []), ("session_cookie" = []), ("media_token" = [])),
    params(("name" = String, Path, description = "The last segment of the URL the upload returned: a uuid and an extension.")),
    responses(
        (status = 200, description = "The image.", body = FileBytes, content_type = "image/*"),
        (status = 404, description = "No image has that name."),
    ),
)]
pub(super) async fn get_journal_image(_user: MediaAuthUser, Path(name): Path<String>) -> Response {
    // Sync `std::fs` read — run on the blocking pool.
    match tokio::task::spawn_blocking(move || db::journal_images::read_journal_image(&name)).await {
        Ok(Some((mime, bytes))) => (
            [
                (header::CONTENT_TYPE, mime),
                // Names are content-unique (uuidv4, never rewritten), so long
                // client-side caching is safe; `private` + `Vary: Cookie` keep
                // shared proxies from serving them across sessions (mirrors
                // covers).
                (
                    header::CACHE_CONTROL,
                    "private, max-age=31536000, immutable",
                ),
                (header::VARY, "Cookie"),
                // Prevent MIME-sniffing an image into an executable type.
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            bytes,
        )
            .into_response(),
        Ok(None) => (axum::http::StatusCode::NOT_FOUND, "image not found").into_response(),
        Err(e) => internal("spawn_blocking(read_journal_image)", e),
    }
}

/// Delete a journal entry
///
/// Deletes one of your entries, and any uploaded image it showed that no other entry
/// shows.
#[utoipa::path(
    delete,
    path = "/api/journals/{id}",
    tag = "Journals",
    params(("id" = String, Path, description = "The entry's id, or the `client_id` it was created with.")),
    responses(
        (status = 204, description = "The entry is deleted."),
        (status = 404, description = "You have no entry with that id. Another user's entry answers the same."),
    ),
)]
pub(super) async fn delete_journal(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let id = match resolve_id(&state, user.id, &id).await {
        Ok(id) => id,
        Err(JournalError::NotFound) => {
            return (axum::http::StatusCode::NOT_FOUND, "journal entry not found").into_response()
        }
        Err(e) => return internal("delete_journal_entry", e),
    };
    match db::journals::delete_journal_entry(&state.pool, user.id, id).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(JournalError::NotFound) => {
            (axum::http::StatusCode::NOT_FOUND, "journal entry not found").into_response()
        }
        Err(e @ JournalError::BookNotFound) => internal("delete_journal_entry", e),
        Err(JournalError::Sqlx(e)) => internal("delete_journal_entry", e),
    }
}

#[cfg(test)]
mod tests;
