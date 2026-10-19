//! Admin device & session management REST handlers. Every route is
//! `AdminUser`-gated (403 for non-admins): list a target user's sessions and
//! devices, and revoke a specific session or device. Companion to
//! `server::auth::handlers`, which owns the self-service equivalents under
//! `/api/auth/sessions`.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, auth::AuthError};
use omnibus_shared::{DeviceView, SessionView};

use super::{internal, AppState};
use crate::auth::session_view::session_views;
use crate::auth::AdminUser;

fn to_device_view(d: db::auth::Device) -> DeviceView {
    DeviceView {
        id: d.id,
        name: d.name,
        client_kind: d.client_kind,
        client_version: d.client_version,
        created_at: d.created_at,
        last_seen_at: d.last_seen_at,
    }
}

/// List a user's sessions
///
/// The user's live sign-ins, on browsers and apps. `is_current` is always `false` here,
/// even for your own session. An unknown user id lists nothing. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/admin/users/{id}/sessions",
    tag = "Admin",
    operation_id = "admin_list_user_sessions",
    params(("id" = i64, Path, description = "The user's id.")),
    responses(
        (status = 200, description = "The user's live sessions.", body = Vec<SessionView>),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_user_sessions(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(user_id): Path<i64>,
) -> Response {
    let rows = match db::auth::list_sessions_for_user(&state.pool, user_id).await {
        Ok(rows) => rows,
        Err(e) => return internal("admin list user sessions", e),
    };
    match session_views(&state.pool, user_id, rows, None).await {
        Ok(views) => Json(views).into_response(),
        Err(e) => internal("admin list user sessions", e),
    }
}

/// List a user's devices
///
/// The apps the user has signed in from, each registered as a device. An unknown user id
/// lists nothing. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/admin/users/{id}/devices",
    tag = "Admin",
    operation_id = "admin_list_user_devices",
    params(("id" = i64, Path, description = "The user's id.")),
    responses(
        (status = 200, description = "The user's devices, most recently seen first.", body = Vec<DeviceView>),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_user_devices(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(user_id): Path<i64>,
) -> Response {
    match db::auth::list_devices_for_user(&state.pool, user_id).await {
        Ok(rows) => Json(rows.into_iter().map(to_device_view).collect::<Vec<_>>()).into_response(),
        Err(e) => internal("admin list user devices", e),
    }
}

/// Revoke a user's session
///
/// Signs one session out, whoever it belongs to. You can't revoke the session you sent
/// this request with; sign out instead. Needs an admin account.
#[utoipa::path(
    delete,
    path = "/api/admin/sessions/{id}",
    tag = "Admin",
    operation_id = "admin_delete_session",
    params(("id" = i64, Path, description = "The session's id, from the sessions listing.")),
    responses(
        (status = 204, description = "The session is revoked."),
        (status = 400, description = "That is the session this request came with."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No live session has that id."),
    ),
)]
pub(super) async fn delete_session(
    admin: AdminUser,
    State(state): State<AppState>,
    Path(session_id): Path<i64>,
) -> Response {
    // Same guard as the self-service `delete_session_handler`: an admin panel isn't exempt
    // from locking its own tab out mid-request.
    if session_id == admin.0.session_id {
        return (
            StatusCode::BAD_REQUEST,
            "cannot revoke the currently-active session",
        )
            .into_response();
    }
    match db::auth::revoke_session_checked(&state.pool, session_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AuthError::SessionNotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal("admin revoke session", e),
    }
}

/// Remove a user's device
///
/// Deletes a device registration, whoever it belongs to, and signs out every session on
/// it. Needs an admin account.
#[utoipa::path(
    delete,
    path = "/api/admin/devices/{id}",
    tag = "Admin",
    operation_id = "admin_delete_device",
    params(("id" = i64, Path, description = "The device's id, from the devices listing.")),
    responses(
        (status = 204, description = "The device and its sessions are gone."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No device has that id."),
    ),
)]
pub(super) async fn delete_device(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(device_id): Path<i64>,
) -> Response {
    match db::auth::revoke_device(&state.pool, device_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AuthError::DeviceNotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal("admin revoke device", e),
    }
}

#[cfg(test)]
mod tests;
