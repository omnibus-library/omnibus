//! Per-book metadata override handlers (REST, mobile-facing), plus the bulk route.
//!
//! Edit-permitted users `POST` / `DELETE` overrides against a book's uuid, or
//! `POST` one edit to many books at once; reads happen via the standard ebook
//! endpoints, which merge overrides into the wire DTO. Mounted on the REST
//! router in [`super::rest_router`].

use axum::{
    body::Bytes,
    extract::{Path, State},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, worker::Task};
use omnibus_shared::{
    detect_image_format, validate_book_uuids, BulkOverridesRequest, CoverFromUrlBody,
    CoverUploadForm, EbookMetadata, ExternalBookMeta, MetadataOverrides,
};

use super::image_upload::extract_validated_image;
use super::{internal, AppState};
use crate::auth::{AdminUser, AuthUser};

/// Edit a book's metadata
///
/// Saves the fields you send over the book's scanned metadata. Fields you leave out keep any
/// earlier edit, and a list field, such as `creators`, replaces the whole list. Answers with
/// the book as it now reads. Needs the edit permission.
#[utoipa::path(
    post,
    path = "/api/ebooks/{uuid}/overrides",
    tag = "Metadata",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body = MetadataOverrides,
    responses(
        (status = 200, description = "The book with your edits.", body = EbookMetadata),
        (status = 400, description = "A field is too long or malformed. The body says which."),
        (status = 403, description = "Your account lacks the edit permission."),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn post_ebook_overrides(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(overrides): Json<MetadataOverrides>,
) -> Response {
    if !user.is_admin && !user.can_edit {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "edit permission required",
        )
            .into_response();
    }
    if let Err(msg) = overrides.validate() {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    // Resolve uuid → id so the thumbnail/cover invalidate calls stay
    // id-keyed. Returns 404 for unknown uuids — same behavior the old
    // `get_book_uuid(id)` -> 404 had for unknown ids.
    let id = match db::resolve_book_id_by_uuid(&state.pool, &uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    };
    // Merge incoming overrides with any existing ones so a second edit that
    // only touches field B doesn't wipe a prior override on field A. The
    // read-merge-write is serialized inside a single BEGIN IMMEDIATE
    // transaction in the db layer so two concurrent edits to the same book
    // can't interleave and drop each other's changes (#166).
    if let Err(e) = db::merge_metadata_overrides(&state.pool, &uuid, &overrides, user.id).await {
        return internal("merge_metadata_overrides", e);
    }
    match db::get_book(&state.pool, id).await {
        Ok(Some(book)) => Json(book).into_response(),
        Ok(None) => (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => internal("get_book", e),
    }
}

/// Edit several books' metadata
///
/// Applies one edit to every book in `uuids`. Tags and genres are added to or removed from
/// each book's current list on the server, so two clients editing at once don't overwrite
/// each other. All-or-nothing: if any book fails, none change. Needs the edit permission.
#[utoipa::path(
    post,
    path = "/api/ebooks/overrides/bulk",
    tag = "Metadata",
    request_body = BulkOverridesRequest,
    responses(
        (status = 204, description = "Every book was edited."),
        (status = 400, description = "No uuids, an empty edit, or a field that is too long or has too many values. The body says which."),
        (status = 403, description = "Your account lacks the edit permission."),
        (status = 404, description = "A uuid matches no book, so none were edited."),
    ),
)]
pub(super) async fn post_bulk_overrides(
    user: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<BulkOverridesRequest>,
) -> Response {
    if !user.is_admin && !user.can_edit {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "edit permission required",
        )
            .into_response();
    }
    if req.uuids.is_empty() {
        return (axum::http::StatusCode::BAD_REQUEST, "no books selected").into_response();
    }
    if req.edit.is_empty() {
        return (axum::http::StatusCode::BAD_REQUEST, "no fields to apply").into_response();
    }
    if let Err(msg) = validate_book_uuids(&req.uuids).and_then(|()| req.edit.validate()) {
        return (axum::http::StatusCode::BAD_REQUEST, msg).into_response();
    }
    match db::bulk_merge_metadata_overrides(&state.pool, &req.uuids, &req.edit, user.id).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e @ db::MetadataOverridesError::BookNotFound(_)) => {
            (axum::http::StatusCode::NOT_FOUND, e.to_string()).into_response()
        }
        Err(e @ db::MetadataOverridesError::TooManyValues { .. }) => {
            (axum::http::StatusCode::BAD_REQUEST, e.to_string()).into_response()
        }
        Err(e) => internal("bulk_merge_metadata_overrides", e),
    }
}

/// Revert a book's metadata
///
/// Removes every edit to the book, its cover included, so it reads as scanned. Answers with
/// the book as it now reads. Needs the edit permission.
#[utoipa::path(
    delete,
    path = "/api/ebooks/{uuid}/overrides",
    tag = "Metadata",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The book as scanned.", body = EbookMetadata),
        (status = 403, description = "Your account lacks the edit permission."),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn delete_ebook_overrides(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    if !user.is_admin && !user.can_edit {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "edit permission required",
        )
            .into_response();
    }
    let id = match db::resolve_book_id_by_uuid(&state.pool, &uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    };
    if let Err(e) = db::delete_metadata_overrides(&state.pool, &uuid).await {
        return internal("delete_metadata_overrides", e);
    }
    // `delete_override_cover` + `invalidate_thumbs` are sync `std::fs`
    // operations; run them on the blocking pool so the axum runtime stays
    // responsive under load (#106).
    let uuid_for_blocking = uuid.clone();
    if let Err(e) = tokio::task::spawn_blocking(move || {
        db::delete_override_cover(&uuid_for_blocking);
        db::thumbs::invalidate_thumbs(id);
    })
    .await
    {
        return internal("spawn_blocking(delete_override_cover)", e);
    }
    match db::get_book(&state.pool, id).await {
        Ok(Some(book)) => Json(book).into_response(),
        Ok(None) => (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => internal("get_book", e),
    }
}

/// Upload a book's cover
///
/// Replaces the book's cover with the image in the form's `cover` part. The book's other
/// metadata edits stay. Answers with the book as it now reads. Needs the edit permission.
#[utoipa::path(
    post,
    path = "/api/ebooks/{uuid}/cover",
    tag = "Covers",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body(content = inline(CoverUploadForm), content_type = "multipart/form-data"),
    responses(
        (status = 200, description = "The book with its new cover.", body = EbookMetadata),
        (status = 400, description = "The form has no `cover` part, the part's content type isn't an image or is SVG, or the image is over 10 MB."),
        (status = 403, description = "Your account lacks the edit permission."),
        (status = 404, description = "No book has that uuid."),
        (status = 415, description = "The `cover` bytes aren't in an image format the server recognizes."),
    ),
)]
pub(super) async fn post_ebook_cover(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    mut multipart: axum::extract::Multipart,
) -> Response {
    if !user.is_admin && !user.can_edit {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "edit permission required",
        )
            .into_response();
    }

    // uuid → id for the thumb-invalidate + `get_book` calls that still
    // use the internal autoincrement key. Returns 404 for unknown uuids,
    // matching the prior `get_book_uuid(id)` → 404 behavior.
    let id = match db::resolve_book_id_by_uuid(&state.pool, &uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    };

    // Extract the cover field from the multipart body.
    let (mime, bytes) = match extract_validated_image(&mut multipart, "cover").await {
        Ok(pair) => pair,
        Err(response) => return response,
    };

    if let Err(e) = persist_cover(&state, &uuid, user.id, mime, bytes).await {
        return internal(e.context, e.detail);
    }

    // Invalidate thumb cache so next request regenerates from new cover.
    // Also sync `std::fs` — run on the blocking pool (#106).
    if let Err(e) = tokio::task::spawn_blocking(move || db::thumbs::invalidate_thumbs(id)).await {
        return internal("spawn_blocking(invalidate_thumbs)", e);
    }

    match db::get_book(&state.pool, id).await {
        Ok(Some(book)) => Json(book).into_response(),
        Ok(None) => (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => internal("get_book", e),
    }
}

/// Set a book's cover from a URL
///
/// Fetches the image at `url` and makes it the book's cover. For a Google Books cover, the
/// server stores the full-size image instead of the thumbnail when it can. The book's other
/// metadata edits stay. Answers with the book as it now reads. Needs the edit permission.
#[utoipa::path(
    post,
    path = "/api/ebooks/{uuid}/cover/from-url",
    tag = "Covers",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body = CoverFromUrlBody,
    responses(
        (status = 200, description = "The book with its new cover.", body = EbookMetadata),
        (status = 400, description = "`url` is empty, over 2,048 bytes or not `https`, its host resolves to a private address, or it doesn't answer with an image of up to 10 MB."),
        (status = 403, description = "Your account lacks the edit permission."),
        (status = 404, description = "No book has that uuid."),
        (status = 415, description = "The URL answered with bytes that aren't an image."),
        (status = 502, description = "The server couldn't reach the URL's host."),
    ),
)]
pub(super) async fn post_ebook_cover_from_url(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(body): Json<CoverFromUrlBody>,
) -> Response {
    // Fetched under `cover_fetch_config_for`'s host-split terms and sniffed before the
    // bytes land on disk. Mounted in `upload_router`, rate-limited: the only override
    // route that spends an outbound fetch.
    if !user.is_admin && !user.can_edit {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "edit permission required",
        )
            .into_response();
    }
    let url = body.url.trim();
    if url.is_empty() {
        return (axum::http::StatusCode::BAD_REQUEST, "url is required").into_response();
    }
    // Capped before the string reaches the fetch pipeline, the same cap
    // `ExternalBookMeta` applies to a provider `cover_url` — a pasted URL has
    // no such source to inherit the cap from, so this route enforces it
    // directly.
    if url.len() > ExternalBookMeta::COVER_URL_MAX_LEN {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            format!(
                "url must be {} bytes or fewer",
                ExternalBookMeta::COVER_URL_MAX_LEN
            ),
        )
            .into_response();
    }

    let id = match db::resolve_book_id_by_uuid(&state.pool, &uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    };

    let config = cover_fetch_config_for(&state, url);
    // `fetch_provider_cover`, not the bare fetch: a Google Books URL costs a second
    // request to store the full-size cover instead of its 128px thumbnail, and falls
    // back to the thumbnail when the larger one can't be shown to be the same picture.
    let (advertised_mime, bytes) = match db::fetch_provider_cover(url, &config).await {
        Ok(pair) => pair,
        Err(db::author_photos::FetchRemoteImageError::Http(e)) => {
            // A transport failure against the *source* is not this server
            // erroring; 502 says whose fault it was.
            tracing::warn!(error = ?e, "cover fetch failed");
            return (
                axum::http::StatusCode::BAD_GATEWAY,
                "could not fetch the cover from that source",
            )
                .into_response();
        }
        // BlockedAddress's Display echoes the resolved IP or hostname, which
        // would let a can_edit user use this route as a DNS/address oracle —
        // fixed body here, detail only in the log.
        Err(e @ db::author_photos::FetchRemoteImageError::BlockedAddress(_)) => {
            tracing::warn!(error = %e, "cover fetch refused by address gate");
            return (
                axum::http::StatusCode::BAD_REQUEST,
                "that address is not allowed",
            )
                .into_response();
        }
        // Everything else is a refusal we made: bad scheme, host off the
        // allowlist, non-image content-type, too large.
        Err(e) => return (axum::http::StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };

    // Magic bytes, not the remote Content-Type: a source serving an HTML
    // error page under `image/jpeg` must not be written as `override-<uuid>.jpg`
    // and served back as a cover.
    let mime = match detect_image_format(&bytes) {
        Some(m) => m,
        None => {
            tracing::warn!(
                advertised_mime,
                "cover URL returned image content-type but bytes are not an image"
            );
            return (
                axum::http::StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "file at URL does not appear to be a valid image",
            )
                .into_response();
        }
    };

    if let Err(e) = persist_cover(&state, &uuid, user.id, mime, Bytes::from(bytes)).await {
        return internal(e.context, e.detail);
    }
    if let Err(e) = tokio::task::spawn_blocking(move || db::thumbs::invalidate_thumbs(id)).await {
        return internal("spawn_blocking(invalidate_thumbs)", e);
    }
    match db::get_book(&state.pool, id).await {
        Ok(Some(book)) => Json(book).into_response(),
        Ok(None) => (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => internal("get_book", e),
    }
}

/// Relaxes `config` for a loopback `wiremock` origin, only when `state`'s injected
/// `RemoteImageConfig` opts in. That one flag relaxes the address, the scheme and the
/// host allowlist together, so a production path can't trip them independently; a
/// production `AppState` is built with `Default` (flag `false`), which
/// `cover_fetch_config_is_strict_by_default` holds true.
fn with_loopback_hatch(
    state: &AppState,
    mut config: db::author_photos::RemoteImageConfig,
) -> db::author_photos::RemoteImageConfig {
    if state.remote_image_config().allow_private_addresses {
        config.require_https = false;
        config.host_allowlist.push("127.0.0.1".to_string());
        config.host_allowlist.push("localhost".to_string());
    }
    config
}

/// The terms the upload commit's provider-cover fetch (`uploads`) runs
/// under: [`db::provider_cover_image_config`] unchanged — HTTPS only, hosts
/// limited to the provider catalog's, private address ranges blocked.
/// Provider-only; [`post_ebook_cover_from_url`] uses [`cover_fetch_config_for`]
/// instead, since a pasted URL may name any host.
pub(super) fn cover_fetch_config(state: &AppState) -> db::author_photos::RemoteImageConfig {
    let loopback_testing = state.remote_image_config().allow_private_addresses;
    with_loopback_hatch(state, db::provider_cover_image_config(loopback_testing))
}

/// The terms [`post_ebook_cover_from_url`]'s fetch runs under for `url` —
/// [`db::cover_image_config_for`]'s split between the provider catalog's
/// allowlisted terms and the pasted terms.
pub(super) fn cover_fetch_config_for(
    state: &AppState,
    url: &str,
) -> db::author_photos::RemoteImageConfig {
    let loopback_testing = state.remote_image_config().allow_private_addresses;
    with_loopback_hatch(state, db::cover_image_config_for(url, loopback_testing))
}

/// Revert a book's cover
///
/// Removes a cover you set, so the book shows the cover from its file again. The book's
/// other metadata edits stay. Answers with the book as it now reads. Needs the edit
/// permission.
#[utoipa::path(
    delete,
    path = "/api/ebooks/{uuid}/cover",
    tag = "Covers",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The book with its scanned cover.", body = EbookMetadata),
        (status = 403, description = "Your account lacks the edit permission."),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn delete_ebook_cover(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    if !user.is_admin && !user.can_edit {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "edit permission required",
        )
            .into_response();
    }
    let id = match db::resolve_book_id_by_uuid(&state.pool, &uuid).await {
        Ok(Some(id)) => id,
        Ok(None) => return (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => return internal("resolve_book_id_by_uuid", e),
    };
    if let Err(e) = db::clear_cover_override(&state.pool, &uuid, user.id).await {
        return internal("clear_cover_override", e);
    }
    // `delete_override_cover` + `invalidate_thumbs` are sync `std::fs`
    // operations; run them on the blocking pool so the axum runtime stays
    // responsive under load (#106).
    let uuid_for_blocking = uuid.clone();
    if let Err(e) = tokio::task::spawn_blocking(move || {
        db::delete_override_cover(&uuid_for_blocking);
        db::thumbs::invalidate_thumbs(id);
    })
    .await
    {
        return internal("spawn_blocking(delete_override_cover)", e);
    }
    match db::get_book(&state.pool, id).await {
        Ok(Some(book)) => Json(book).into_response(),
        Ok(None) => (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        Err(e) => internal("get_book", e),
    }
}

/// A cover persist that failed: which step, and its detail. Every failure
/// here is a 500 — the bytes were validated before this ran — so the cover
/// routes render it with [`internal`] and the upload commit carries it in
/// its own error type.
#[derive(Debug)]
pub(super) struct CoverPersistError {
    pub(super) context: &'static str,
    pub(super) detail: String,
}

impl CoverPersistError {
    fn new(context: &'static str, e: impl std::fmt::Display) -> Self {
        Self {
            context,
            detail: e.to_string(),
        }
    }
}

/// Write the new override cover to disk and mark `has_cover_override = 1`, preserving any
/// existing field overrides. The prior overrides row is read BEFORE touching disk, since
/// `write_override_cover` deletes any existing `override-<uuid>.*`. If the upsert fails,
/// the just-written file is cleaned up ONLY when no prior override cover existed: else the
/// write already replaced the user's previous cover and cleanup would compound the loss.
pub(super) async fn persist_cover(
    state: &AppState,
    uuid: &str,
    user_id: i64,
    mime: String,
    bytes: Bytes,
) -> Result<(), CoverPersistError> {
    let (existing_overrides, had_prior_cover_override) =
        match db::get_metadata_overrides(&state.pool, uuid).await {
            Ok(Some((ov, has_cover))) => (ov, has_cover),
            Ok(None) => (MetadataOverrides::default(), false),
            Err(e) => return Err(CoverPersistError::new("get_metadata_overrides", e)),
        };

    // `write_override_cover` is a sync `std::fs` call — run it on the blocking
    // pool so the axum runtime stays responsive while we hit disk (#106).
    let uuid_for_write = uuid.to_string();
    let write_result = tokio::task::spawn_blocking(move || {
        db::write_override_cover(&uuid_for_write, &mime, &bytes)
    })
    .await;
    match write_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(CoverPersistError::new("write_override_cover", e)),
        Err(e) => {
            return Err(CoverPersistError::new(
                "spawn_blocking(write_override_cover)",
                e,
            ))
        }
    }

    if let Err(e) =
        db::upsert_metadata_overrides(&state.pool, uuid, &existing_overrides, true, user_id).await
    {
        if !had_prior_cover_override {
            cleanup_orphan_cover(uuid).await;
        }
        return Err(CoverPersistError::new("upsert_metadata_overrides", e));
    }
    Ok(())
}

/// Bake metadata edits into every EPUB
///
/// Queues a background job that writes each edited book's metadata and cover into the copy
/// of its EPUB that downloads serve. The library's own files aren't changed. Answers as
/// soon as the job is queued. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/admin/rewrite-all-epubs",
    tag = "Admin",
    responses(
        (status = 200, description = "The job is queued."),
        (status = 403, description = "Your account isn't an admin."),
    ),
)]
pub(super) async fn post_rewrite_all_epubs(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> Response {
    // The bulk sibling of the per-book export bake `get_ebook_download` does on demand.
    state.worker().post(Task::RewriteAllEpubs);
    axum::http::StatusCode::OK.into_response()
}

/// Best-effort delete of the on-disk override cover after a DB failure in
/// `post_ebook_cover`. The inner call swallows its own filesystem errors and a
/// `JoinError` is logged but ignored: the caller is already returning the original
/// DB error, and a missing cover file is preferred over a dangling file with no row.
async fn cleanup_orphan_cover(uuid: &str) {
    tracing::warn!(uuid, "cover upload DB step failed — removing orphan file");
    let uuid = uuid.to_string();
    // `delete_override_cover` is a synchronous `std::fs` call, so it runs on the
    // blocking pool to keep the axum runtime responsive.
    if let Err(e) = tokio::task::spawn_blocking(move || db::delete_override_cover(&uuid)).await {
        tracing::warn!(error = %e, "spawn_blocking(delete_override_cover) join failed");
    }
}

#[cfg(test)]
mod tests;
