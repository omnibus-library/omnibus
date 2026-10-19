//! Author-photo serve and admin override handlers. Cookie-gated `GET` returns
//! the cached photo bytes, with a 404 kicking off background Open Library
//! resolution; admin-only `PUT` / `DELETE` accepts an uploaded photo or a
//! remote URL via the SSRF-guarded `fetch_remote_image` helper.

use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, worker::Task};
use omnibus_shared::{
    detect_image_format, AuthorPhotoScanResult, AuthorPhotoUpload, AuthorPhotoUrlBody,
};

use super::image_upload::extract_validated_image;
use super::{internal, AppState};
use crate::auth::{AdminUser, MediaAuthUser};

/// Get an author's photo
///
/// The author's profile photo. When none is cached, the server looks for one at Open
/// Library in the background, so a later request may find it. Once Open Library has had
/// none, the author stays without a photo until an admin deletes the photo record or
/// scans again.
#[utoipa::path(
    get,
    path = "/api/authors/{id}/photo",
    tag = "Discovery",
    security(("bearer" = []), ("session_cookie" = []), ("media_token" = [])),
    params(("id" = i64, Path, description = "The author's id.")),
    responses(
        (status = 200, description = "The photo.", body = [u8], content_type = "image/*"),
        (status = 404, description = "The author has no photo, or no author has that id."),
    ),
)]
pub(super) async fn get_author_photo(
    _user: MediaAuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match db::get_author_photo(&state.pool, id).await {
        Ok(Some((mime, bytes))) => (
            [
                (header::CONTENT_TYPE, mime.as_str()),
                // Match `/api/covers/:id` cache semantics.
                (header::CACHE_CONTROL, "private, max-age=86400"),
                (header::VARY, "Cookie"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            bytes,
        )
            .into_response(),
        Ok(None) => {
            // A 404 keeps the client on its letter avatar. Only queue resolution if
            // no row exists yet — a `letter` marker is a sticky miss until an admin
            // DELETEs it. `author_photo_status` returns the row regardless of source.
            if let Ok(None) = db::author_photo_status(&state.pool, id).await {
                state
                    .worker
                    .post(Task::ResolveAuthorPhoto { author_id: id });
            }
            axum::http::StatusCode::NOT_FOUND.into_response()
        }
        Err(error) => internal("read author photo", error),
    }
}

/// Upload an author's photo
///
/// Sets the author's photo from an uploaded image. An uploaded photo wins over one found
/// at Open Library, and a scan doesn't replace it. Needs an admin account.
#[utoipa::path(
    put,
    path = "/api/authors/{id}/photo",
    tag = "Discovery",
    params(("id" = i64, Path, description = "The author's id.")),
    request_body(content = inline(AuthorPhotoUpload), content_type = "multipart/form-data"),
    responses(
        (status = 204, description = "The photo is saved."),
        (status = 400, description = "The form has no `photo` part, or the part's content type isn't `image/*`, is SVG, or the image is larger than 10 MiB."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No author has that id."),
        (status = 415, description = "The bytes aren't a JPEG, PNG, GIF or WebP image."),
    ),
)]
pub(super) async fn put_author_photo(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    mut multipart: axum::extract::Multipart,
) -> Response {
    // Same validation as the cover upload: 10 MiB cap, magic-byte sniff, no SVG.
    // Confirm the author exists before reading multipart so a malformed
    // upload to a missing id fails fast with 404 (not 400).
    let exists = match db::author_exists(&state.pool, id).await {
        Ok(v) => v,
        Err(e) => return internal("author exists check", e),
    };
    if !exists {
        return (axum::http::StatusCode::NOT_FOUND, "author not found").into_response();
    }

    let (mime, bytes) = match extract_validated_image(&mut multipart, "photo").await {
        Ok(pair) => pair,
        Err(response) => return response,
    };

    if let Err(e) = db::upsert_author_photo(
        &state.pool,
        id,
        db::AuthorPhotoSource::Manual,
        None,
        Some(&mime),
        Some(&bytes),
    )
    .await
    {
        return internal("upsert_author_photo", e);
    }
    axum::http::StatusCode::NO_CONTENT.into_response()
}

/// Delete an author's photo
///
/// Drops the author's photo, uploaded or found, and any record that Open Library had
/// none. The next request for the photo starts a fresh search. Succeeds when there is no
/// photo, and for an unknown id. Needs an admin account.
#[utoipa::path(
    delete,
    path = "/api/authors/{id}/photo",
    tag = "Discovery",
    params(("id" = i64, Path, description = "The author's id.")),
    responses(
        (status = 204, description = "The photo is gone."),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn delete_author_photo(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match db::delete_author_photo(&state.pool, id).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => internal("delete_author_photo", e),
    }
}

/// Search Open Library for an author's photo
///
/// Drops a photo found earlier, or the record that Open Library had none, and asks Open
/// Library again, answering once it has. `resolved` says whether a photo was found. An
/// uploaded photo is kept as it is, and the answer is `resolved: true`. Needs an admin
/// account.
#[utoipa::path(
    post,
    path = "/api/authors/{id}/photo/scan",
    tag = "Discovery",
    params(("id" = i64, Path, description = "The author's id.")),
    responses(
        (status = 200, description = "Whether the author has a photo now.", body = AuthorPhotoScanResult),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No author has that id."),
    ),
)]
pub(super) async fn post_author_photo_scan(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    // Verify the author exists first so a typo on the id gets a 404 instead
    // of a successful no-op scan.
    let exists = match db::author_exists(&state.pool, id).await {
        Ok(v) => v,
        Err(e) => return internal("author exists check", e),
    };
    if !exists {
        return (axum::http::StatusCode::NOT_FOUND, "author not found").into_response();
    }
    // Manual uploads win — don't delete or overwrite. Treat scan as a no-op
    // and report resolved=true so the UI keeps the existing photo.
    match db::author_photo_status(&state.pool, id).await {
        Ok(Some((db::AuthorPhotoSource::Manual, _))) => {
            return Json(AuthorPhotoScanResult { resolved: true }).into_response();
        }
        Ok(_) => {}
        Err(e) => return internal("author_photo_status (pre-scan)", e),
    }
    if let Err(e) = db::delete_author_photo(&state.pool, id).await {
        return internal("delete_author_photo (pre-scan)", e);
    }
    if let Err(e) = db::author_photos::resolve(&state.pool, id).await {
        return internal("author_photos::resolve", e);
    }
    let resolved = match db::get_author_photo(&state.pool, id).await {
        Ok(opt) => opt.is_some(),
        Err(e) => return internal("get_author_photo (post-scan)", e),
    };
    Json(AuthorPhotoScanResult { resolved }).into_response()
}

/// Refetch every author's photo
///
/// Drops every photo found at Open Library and searches again for every author, in the
/// background. Uploaded photos are kept. Answers at once, before the work starts. Needs
/// an admin account.
#[utoipa::path(
    post,
    path = "/api/authors/refetch-photos",
    tag = "Admin",
    responses(
        (status = 202, description = "The refetch is queued."),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn post_refetch_author_photos(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> Response {
    state.worker.post(Task::RefetchAuthorPhotos);
    axum::http::StatusCode::ACCEPTED.into_response()
}

/// Set an author's photo from a URL
///
/// Downloads the image at `url` and saves it as the author's photo, the same as an
/// upload: it wins over Open Library, and a scan doesn't replace it. The server fetches
/// the URL itself, refuses addresses inside its own network, and doesn't follow
/// redirects. Needs an admin account.
#[utoipa::path(
    put,
    path = "/api/authors/{id}/photo/url",
    tag = "Discovery",
    params(("id" = i64, Path, description = "The author's id.")),
    request_body = AuthorPhotoUrlBody,
    responses(
        (status = 204, description = "The photo is saved."),
        (status = 400, description = "`url` is empty, longer than 2048 bytes, not `http` or `https`, or points inside the server's network, or what it serves isn't a JPEG, PNG, GIF or WebP image of 10 MiB or less; the body says which."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No author has that id."),
    ),
)]
pub(super) async fn put_author_photo_url(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<AuthorPhotoUrlBody>,
) -> Response {
    let exists = match db::author_exists(&state.pool, id).await {
        Ok(v) => v,
        Err(e) => return internal("author exists check", e),
    };
    if !exists {
        return (axum::http::StatusCode::NOT_FOUND, "author not found").into_response();
    }

    let url = body.url.trim();
    if url.is_empty() {
        return (axum::http::StatusCode::BAD_REQUEST, "url is required").into_response();
    }
    // Cap before handing the string to the fetch pipeline so a multi-megabyte
    // URL can't allocate/parse unbounded. Shares the RPC path's cap (#456).
    if url.len() > omnibus_shared::AUTHOR_PHOTO_URL_MAX_LEN {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            format!(
                "url must be {} bytes or fewer",
                omnibus_shared::AUTHOR_PHOTO_URL_MAX_LEN
            ),
        )
            .into_response();
    }

    let (advertised_mime, bytes) =
        match db::author_photos::fetch_remote_image_with(url, state.remote_image_config()).await {
            Ok(pair) => pair,
            Err(db::author_photos::FetchRemoteImageError::Http(e)) => {
                return internal("fetch remote image", e);
            }
            Err(e) => {
                // All other variants are validation errors (bad scheme, blocked
                // SSRF target, non-image content-type, too-large, …) — map to
                // 400 with the user-facing message from `#[error]`.
                return (axum::http::StatusCode::BAD_REQUEST, e.to_string()).into_response();
            }
        };

    // Magic-byte sniff — don't trust the remote Content-Type header.
    let mime = match detect_image_format(&bytes) {
        Some(m) => m,
        None => {
            tracing::warn!(
                advertised_mime,
                "remote URL returned image content-type but bytes are not a recognized image"
            );
            return (
                axum::http::StatusCode::BAD_REQUEST,
                "file at URL does not appear to be a valid image",
            )
                .into_response();
        }
    };

    if let Err(e) = db::upsert_author_photo(
        &state.pool,
        id,
        db::AuthorPhotoSource::Manual,
        Some(url),
        Some(&mime),
        Some(&bytes),
    )
    .await
    {
        return internal("upsert_author_photo (url)", e);
    }
    axum::http::StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests;
