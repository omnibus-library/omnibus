//! Cross-format REST endpoints for a dual-format book: the mapped "resume in
//! the other format" candidate and the alignment payload, plus the writes that
//! confirm or remove the link, declare a sync point, and toggle follow mode.

use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use omnibus_shared::cross_format::{
    AlignmentView, ConfirmCrossFormatLink, CrossFormatResume, CrossFormatResumeQuery,
    DeclareSyncPoint, SetFollowMode,
};
use omnibus_shared::ProgressFormat;

use omnibus_db as db;

use super::{internal, AppState};
use crate::auth::AuthUser;

#[cfg(test)]
mod tests;

/// One error mapping for every handler in this module: 404 for an unknown
/// book, 409 for declaration refusals the client can act on, 500 for the
/// rest.
fn error_response(op: &'static str, e: db::cross_format::CrossFormatError) -> Response {
    use db::cross_format::CrossFormatError as E;
    match e {
        E::BookNotFound => (axum::http::StatusCode::NOT_FOUND, "book not found").into_response(),
        e @ (E::AudioSetMismatch | E::LinkRequired | E::CounterpartMissing) => {
            (axum::http::StatusCode::CONFLICT, e.to_string()).into_response()
        }
        E::Sqlx(e) => internal(op, e),
    }
}

/// Get the resume point in the other format
///
/// For a book you have as both an ebook and an audiobook: your position in the other
/// format, mapped onto `target`, when it is newer than your position in `target`. Without
/// a candidate, `state` says why: the formats aren't linked, the link is out of date
/// because the audio files changed, or there is nothing newer to resume.
#[utoipa::path(
    get,
    path = "/api/books/{uuid}/cross-format-resume",
    tag = "Progress",
    params(("uuid" = String, Path, description = "The book's uuid."), CrossFormatResumeQuery),
    responses(
        (status = 200, description = "The resume candidate, or the reason there is none.", body = CrossFormatResume),
        (status = 400, description = "`target` is missing, or not `epub` or `audio`."),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn get_cross_format_resume(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Query(q): Query<CrossFormatResumeQuery>,
) -> Response {
    match db::cross_format::resume_candidate(&state.pool, user.id, &uuid, q.target).await {
        Ok(mut resume) => {
            // Response-only derivation, mirroring the Kobo follow lane: the
            // stored rows are never touched, and a derivation failure just
            // leaves the fraction fallback in place.
            if q.derive.as_deref() == Some("cfi") {
                if let Some(c) = resume.candidate.as_mut() {
                    if c.target == ProgressFormat::Epub && c.epub_cfi.is_none() {
                        if let Some(frac) = c.fraction {
                            c.epub_cfi =
                                db::cross_format::derive_candidate_cfi(&state.pool, &uuid, frac)
                                    .await;
                        }
                    }
                }
            }
            Json(resume).into_response()
        }
        Err(e) => error_response("cross_format_resume", e),
    }
}

/// Get a book's format alignment
///
/// Everything needed to show how the ebook and the audiobook line up: the link and whether
/// it is out of date, the ebook's chapters, the audio files with their chapters, the anchor
/// pairs, and your current position in each format.
#[utoipa::path(
    get,
    path = "/api/books/{uuid}/alignment",
    tag = "Progress",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 200, description = "The alignment.", body = AlignmentView),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn get_alignment(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    // Mirrors `rpc_get_alignment`.
    match db::cross_format::alignment_view(&state.pool, user.id, &uuid).await {
        Ok(view) => Json(view).into_response(),
        Err(e) => error_response("get_alignment", e),
    }
}

/// Link a book's formats
///
/// Confirms how the ebook and the audiobook line up, which turns position sync between
/// them on. Confirming again replaces the link; your sync points survive only when the
/// audio files, their order, the mode and the primary narration are all unchanged. The
/// path's uuid is used, not the body's `book_uuid`. `audio_order` also reorders the book's
/// audio files for every user, so sending it needs the edit permission.
#[utoipa::path(
    post,
    path = "/api/books/{uuid}/cross-format-link",
    tag = "Progress",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body = ConfirmCrossFormatLink,
    responses(
        (status = 204, description = "The formats are linked and sync is on."),
        (status = 403, description = "The body has `audio_order` and your account lacks the edit permission."),
        (status = 404, description = "No book has that uuid."),
        (status = 409, description = "`audio_order` doesn't list exactly the book's current audio files."),
        (status = 422, description = "`narrations` mode came without `primary_book_file_id`, or `audio_order` repeats a file."),
    ),
)]
pub(super) async fn post_cross_format_link(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(mut update): Json<ConfirmCrossFormatLink>,
) -> Response {
    update.book_uuid = uuid;
    if let Err(msg) = update.validate() {
        return (axum::http::StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
    }
    // The same gate as `rpc_confirm_cross_format_link`: a re-order is library-wide.
    if update.audio_order.is_some() && !user.can_edit {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "reordering audio files requires edit permission",
        )
            .into_response();
    }
    // One transactional confirm: a riding re-order is a library-wide
    // mutation and must never commit without its link (or vice versa).
    match db::cross_format::confirm_link(
        &state.pool,
        user.id,
        &update.book_uuid,
        update.mode,
        update.primary_book_file_id,
        update.audio_order.as_deref(),
    )
    .await
    {
        Ok(_) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => error_response("confirm_cross_format", e),
    }
}

/// Unlink a book's formats
///
/// Removes the link, which turns position sync between the formats off. Succeeds whether
/// or not a link existed.
#[utoipa::path(
    delete,
    path = "/api/books/{uuid}/cross-format-link",
    tag = "Progress",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses(
        (status = 204, description = "No link remains."),
        (status = 404, description = "No book has that uuid."),
    ),
)]
pub(super) async fn delete_cross_format_link(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    // Mirrors `rpc_unlink_cross_format`.
    match db::cross_format::delete_link(&state.pool, user.id, &uuid).await {
        Ok(_) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => error_response("unlink_cross_format", e),
    }
}

/// Declare a sync point
///
/// Says "this spot in the format I'm using matches where I am in the other one". The body
/// gives your position in the declaring format; your saved position in the other format
/// supplies the match. The pair calibrates how the formats map from then on. A book with
/// one audio file and no link gets linked, with follow on; an existing link keeps its
/// follow setting. The path's uuid is used, not the body's `book_uuid`.
#[utoipa::path(
    post,
    path = "/api/books/{uuid}/sync-point",
    tag = "Progress",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body = DeclareSyncPoint,
    responses(
        (status = 204, description = "The sync point is stored."),
        (status = 404, description = "No book has that uuid."),
        (status = 409, description = "The book has several audio files and no link yet, the audio files changed since the link was confirmed, or the pair can't be made: the other format has no saved position, or a position names no audio file of the link."),
        (status = 422, description = "An `epub` declaration lacks `ebook_fraction` or has one outside 0 to 1, or an `audio` declaration lacks `audio_seconds` or has a negative one."),
    ),
)]
pub(super) async fn post_sync_point(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(mut decl): Json<DeclareSyncPoint>,
) -> Response {
    decl.book_uuid = uuid;
    if let Err(msg) = decl.validate() {
        return (axum::http::StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
    }
    match db::cross_format::declare_sync_point(&state.pool, user.id, &decl).await {
        Ok(_) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => error_response("declare_sync_point", e),
    }
}

/// Turn follow mode on or off
///
/// With follow on, a client moves to the newer position in the other format without
/// asking. Needs a confirmed link.
#[utoipa::path(
    post,
    path = "/api/books/{uuid}/cross-format-follow",
    tag = "Progress",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    request_body = SetFollowMode,
    responses(
        (status = 204, description = "Follow mode is set."),
        (status = 404, description = "No book has that uuid."),
        (status = 409, description = "The book's formats aren't linked."),
    ),
)]
pub(super) async fn post_cross_format_follow(
    user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    Json(body): Json<SetFollowMode>,
) -> Response {
    match db::cross_format::set_follow(&state.pool, user.id, &uuid, body.enabled).await {
        Ok(true) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            axum::http::StatusCode::CONFLICT,
            "confirm the alignment first",
        )
            .into_response(),
        Err(e) => error_response("set_follow", e),
    }
}
