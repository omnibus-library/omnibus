//! Suggestions REST handlers (mobile-facing) plus the admin Hardcover-key
//! API; web hits the analogous `/api/rpc/*` server functions. Serves the
//! cache-backed "readers also enjoyed" strip (`GET .../suggestions`), streams
//! cached cover bytes (`GET .../cover`), and reads/writes the masked
//! account-level key (`GET`/`POST /api/hardcover-key`, admin-only).

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, worker::Task};
use omnibus_shared::{
    BookSuggestion, FileBytes, HardcoverKeyStatus, RawSuggestion, SetHardcoverKey,
    SuggestionsResponse,
};

use super::{internal, AppState};
use crate::auth::{AdminUser, AuthUser, MediaAuthUser};

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_secs()).ok())
        .unwrap_or(0)
}

/// Get a book's suggestions
///
/// Books that Hardcover's curated lists pair with this one, for a "readers also enjoyed"
/// strip. `status` is `not_configured` when the server has no Hardcover key, `pending`
/// while the server fetches them in the background (ask again shortly), or `ready` with
/// the items, which may be empty. Results are kept for 30 days, then refreshed.
#[utoipa::path(
    get,
    path = "/api/ebooks/{uuid}/suggestions",
    tag = "Metadata",
    params(("uuid" = String, Path, description = "The book's uuid.")),
    responses((status = 200, description = "The suggestions, or why there are none yet.", body = SuggestionsResponse)),
)]
pub(super) async fn get_suggestions(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Response {
    match db::effective_hardcover_api_key(&state.pool).await {
        Ok(None) => return Json(SuggestionsResponse::NotConfigured).into_response(),
        Ok(Some(_)) => {}
        Err(e) => return internal("read hardcover key", e),
    }
    let marker = match db::suggestion_state(&state.pool, &uuid).await {
        Ok(m) => m,
        Err(e) => return internal("read suggestion state", e),
    };
    // Marking `pending` before the post means a refresh or a burst of viewers
    // enqueues one resolution, never one each.
    let decision = db::decide(marker, now_secs());
    if decision.enqueue {
        if let Err(e) = db::mark_pending(&state.pool, &uuid).await {
            return internal("mark suggestions pending", e);
        }
        state.worker.post(Task::ResolveSuggestions {
            book_uuid: uuid.clone(),
        });
    }
    if !decision.serve {
        return Json(SuggestionsResponse::Pending).into_response();
    }
    match db::get_suggestions(&state.pool, &uuid).await {
        Ok(rows) => {
            let items = rows
                .into_iter()
                .map(|c| {
                    BookSuggestion::new(
                        &uuid,
                        c.rank,
                        RawSuggestion {
                            hardcover_id: c.hardcover_id,
                            hardcover_slug: c.hardcover_slug,
                            title: c.title,
                            author: c.author,
                            list_count: c.list_count,
                        },
                        c.has_cover,
                    )
                })
                .collect();
            Json(SuggestionsResponse::Ready { items }).into_response()
        }
        Err(e) => internal("read suggestions", e),
    }
}

/// Get a suggestion's cover
///
/// The cover of one suggested book. A suggestion's `cover_url` points here when it has a
/// cover.
#[utoipa::path(
    get,
    path = "/api/suggestions/{uuid}/{rank}/cover",
    tag = "Metadata",
    security(("bearer" = []), ("session_cookie" = []), ("media_token" = [])),
    params(
        ("uuid" = String, Path, description = "The uuid of the book the suggestion is for."),
        ("rank" = i64, Path, description = "The suggestion's rank, from its `cover_url`."),
    ),
    responses(
        (status = 200, description = "The cover image.", body = FileBytes, content_type = "image/*"),
        (status = 404, description = "No cover is stored for that book and rank."),
    ),
)]
pub(super) async fn get_suggestion_cover(
    _user: MediaAuthUser,
    State(state): State<AppState>,
    Path((uuid, rank)): Path<(String, i64)>,
) -> Response {
    match db::get_suggestion_cover(&state.pool, &uuid, rank).await {
        Ok(Some((mime, bytes))) => (
            [
                (header::CONTENT_TYPE, mime.as_str()),
                (header::CACHE_CONTROL, "private, max-age=86400"),
                (header::VARY, "Cookie"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            bytes,
        )
            .into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal("read suggestion cover", e),
    }
}

/// Get the Hardcover key's status
///
/// Whether a Hardcover API key is set, where it comes from, and a masked preview. The key
/// itself is never returned. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/hardcover-key",
    tag = "Admin",
    responses(
        (status = 200, description = "The key's status.", body = HardcoverKeyStatus),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_hardcover_key(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> Response {
    match db::hardcover_key_status(&state.pool).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => internal("read hardcover key", e),
    }
}

/// Set the Hardcover key
///
/// Saves the server-wide Hardcover API token, or clears it when `key` is `null`, absent or
/// blank. The key turns on book suggestions, makes Hardcover the first source for
/// summaries, and adds it as the last source for ISBN lookups. Clearing the saved key
/// falls back to the server's `HARDCOVER_API_KEY` environment variable, when that is set.
/// Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/hardcover-key",
    tag = "Admin",
    request_body = SetHardcoverKey,
    responses(
        (status = 200, description = "The key's new status.", body = HardcoverKeyStatus),
        (status = 403, description = "You aren't an admin."),
        (status = 422, description = "The key is longer than 2048 bytes."),
    ),
)]
pub(super) async fn post_hardcover_key(
    _admin: AdminUser,
    State(state): State<AppState>,
    Json(body): Json<SetHardcoverKey>,
) -> Response {
    match db::set_hardcover_api_key(&state.pool, body.key.as_deref()).await {
        Ok(()) => {}
        Err(db::SettingsError::Validation(msg)) => {
            return (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
        }
        Err(e) => return internal("save hardcover key", e),
    }
    match db::hardcover_key_status(&state.pool).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => internal("read hardcover key", e),
    }
}

#[cfg(test)]
mod tests;
