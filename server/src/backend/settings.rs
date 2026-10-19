//! `GET` / `POST /api/settings` handlers.
//!
//! Admin-gated read and write of the library-path settings KV. A successful
//! save dispatches a `Task::Scan` on the shared worker so the indexer
//! reflects any new library directory.

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db,
    worker::{Task, TaskOutcome},
};
use omnibus_shared::{McpStatus, RegistrationStatus, Settings};

use super::{internal, AppState};
use crate::auth::AdminUser;

/// Get the library settings
///
/// Where the ebook and audiobook libraries live, and how often the server rescans them.
/// Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/settings",
    tag = "Admin",
    responses(
        (status = 200, description = "The library settings.", body = Settings),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_settings(_admin: AdminUser, State(state): State<AppState>) -> Response {
    match db::get_settings(&state.pool).await {
        Ok(settings) => Json(settings).into_response(),
        Err(error) => internal("read settings", error),
    }
}

/// Save the library settings
///
/// Replaces the library settings and, when an ebook library is set, starts a rescan of it
/// in the background. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/settings",
    tag = "Admin",
    request_body = Settings,
    responses(
        (status = 200, description = "The settings are saved; the body is what is now set.", body = Settings),
        (status = 403, description = "You aren't an admin."),
        (status = 422, description = "A library path is over 4096 bytes, or `scan_interval_hours` is below 1."),
    ),
)]
pub(super) async fn post_settings(
    _admin: AdminUser,
    State(state): State<AppState>,
    Json(settings): Json<Settings>,
) -> Response {
    if let Err(e) = settings.validate() {
        return (axum::http::StatusCode::UNPROCESSABLE_ENTITY, e.to_string()).into_response();
    }
    match db::set_settings(&state.pool, &settings).await {
        Ok(()) => match db::get_settings(&state.pool).await {
            Ok(updated) => {
                // Library path may have changed (and even when it hasn't,
                // the user has signalled they want to pick up on-disk
                // changes). Hand the reindex to the shared Worker so the
                // per-path mutex serializes overlapping saves and the
                // scan_concurrency cap stays honored.
                let task_id = updated
                    .ebook_library_path
                    .clone()
                    .map(|library_path| state.worker.post(Task::Scan { library_path }));

                let mut response = Json(updated).into_response();
                #[cfg(debug_assertions)]
                if let Some(id) = task_id {
                    if let Ok(value) = id.to_string().parse::<axum::http::HeaderValue>() {
                        response
                            .headers_mut()
                            .insert("X-Omnibus-Worker-Task-Id", value);
                    }
                }
                #[cfg(not(debug_assertions))]
                let _ = task_id;
                response
            }
            Err(error) => internal("read updated settings", error),
        },
        Err(error) => internal("save settings", error),
    }
}

/// Open or close registration
///
/// Chooses whether `POST /api/auth/register` accepts new accounts. Anyone can read the
/// setting, signed in or not, with `GET /api/auth/registration`. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/settings/registration",
    tag = "Admin",
    request_body = RegistrationStatus,
    responses(
        (status = 204, description = "The setting is saved."),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn post_registration(
    _admin: AdminUser,
    State(state): State<AppState>,
    Json(status): Json<RegistrationStatus>,
) -> Response {
    // Only the write is gated: the sign-in and sign-up pages read the setting before a
    // session exists.
    match db::auth::set_registration_enabled(&state.pool, status.enabled).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(error) => internal("set registration enabled", error),
    }
}

/// Check whether the MCP endpoint is on
///
/// Whether the server answers MCP clients at `/mcp`. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/settings/mcp",
    tag = "Admin",
    responses(
        (status = 200, description = "Whether `/mcp` is on.", body = McpStatus),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_mcp(_admin: AdminUser, State(state): State<AppState>) -> Response {
    match db::mcp_enabled(&state.pool).await {
        Ok(enabled) => Json(McpStatus { enabled }).into_response(),
        Err(error) => internal("read mcp enabled", error),
    }
}

/// Turn the MCP endpoint on or off
///
/// Chooses whether the server answers MCP clients at `/mcp`. The change applies to the
/// next `/mcp` request, with no restart. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/settings/mcp",
    tag = "Admin",
    request_body = McpStatus,
    responses(
        (status = 204, description = "The setting is saved."),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn post_mcp(
    _admin: AdminUser,
    State(state): State<AppState>,
    Json(status): Json<McpStatus>,
) -> Response {
    match db::set_mcp_enabled(&state.pool, status.enabled).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(error) => internal("set mcp enabled", error),
    }
}

/// Rescan the ebook library
///
/// Scans the ebook library folder for added, changed and removed books, and answers when
/// the scan is done. Audiobooks aren't scanned; `POST /api/scan-library` covers both
/// libraries without waiting. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/reindex",
    tag = "Admin",
    responses(
        (status = 200, description = "The scan is done."),
        (status = 403, description = "You aren't an admin."),
        (status = 409, description = "No ebook library path is set."),
    ),
)]
pub(super) async fn post_reindex(_admin: AdminUser, State(state): State<AppState>) -> Response {
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(error) => return internal("read settings", error),
    };
    let Some(library_path) = settings.ebook_library_path else {
        return (
            axum::http::StatusCode::CONFLICT,
            "no ebook library path configured",
        )
            .into_response();
    };
    let task_id = state.worker.post(Task::Scan { library_path });
    match state.worker.await_completion(task_id).await {
        TaskOutcome::Ok(_) => axum::http::StatusCode::OK.into_response(),
        TaskOutcome::Err(e) => internal("reindex", e),
    }
}

/// Rescan both libraries
///
/// Queues a scan of the ebook and audiobook library folders, whichever are set, and answers
/// without waiting for them. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/scan-library",
    tag = "Admin",
    responses(
        (status = 200, description = "The scans are queued."),
        (status = 403, description = "You aren't an admin."),
        (status = 409, description = "Neither library path is set."),
    ),
)]
pub(super) async fn post_scan_library(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> Response {
    // Fire-and-forget twin of the web `rpc_scan_library`.
    let settings = match db::get_settings(&state.pool).await {
        Ok(s) => s,
        Err(error) => return internal("read settings", error),
    };
    if settings.ebook_library_path.is_none() && settings.audiobook_library_path.is_none() {
        return (
            axum::http::StatusCode::CONFLICT,
            "no library path configured",
        )
            .into_response();
    }
    if let Some(library_path) = settings.ebook_library_path {
        state.worker.post(Task::Scan { library_path });
    }
    if let Some(library_path) = settings.audiobook_library_path {
        state.worker.post(Task::ScanAudiobooks { library_path });
    }
    axum::http::StatusCode::OK.into_response()
}

/// Rebuild the search index
///
/// Rebuilds the index book search reads from the library's current records, and answers
/// when it is done. Use it when search results don't match the library. Needs an admin
/// account.
#[utoipa::path(
    post,
    path = "/api/fts/rebuild",
    tag = "Admin",
    operation_id = "rebuild_search_index",
    responses(
        (status = 200, description = "The index is rebuilt."),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn post_rebuild_fts(_admin: AdminUser, State(state): State<AppState>) -> Response {
    // Clears `books_fts` and re-derives every row from `books`, repairing drift left by a
    // failed post-commit FTS refresh.
    let task_id = state.worker.post(Task::RebuildFtsIndex);
    match state.worker.await_completion(task_id).await {
        TaskOutcome::Ok(_) => axum::http::StatusCode::OK.into_response(),
        TaskOutcome::Err(e) => internal("rebuild fts", e),
    }
}

#[cfg(test)]
mod tests;
