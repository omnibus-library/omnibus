//! Admin user-management REST handlers. Every route is `AdminUser`-gated
//! (403 for non-admins): list, create, update permissions, reset password,
//! unlock, and delete — with the last-admin guardrails enforced by the db
//! layer surfaced as `409 Conflict`.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, auth::AuthError};
use omnibus_shared::{AdminUserRow, CreateUserRequest, SetPasswordRequest, UserPermissions};

use super::{internal, AppState};
use crate::auth::AdminUser;

/// List users
///
/// Every account on the server, up to 1000, with its permissions and whether it is locked
/// out. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/admin/users",
    tag = "Admin",
    operation_id = "admin_list_users",
    responses(
        (status = 200, description = "The users, oldest first.", body = Vec<AdminUserRow>),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_users(_admin: AdminUser, State(state): State<AppState>) -> Response {
    match db::auth::list_users(&state.pool).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => internal("list users", e),
    }
}

/// Create a user
///
/// Makes an account with the permissions you give it, whether or not registration is open.
/// Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/admin/users",
    tag = "Admin",
    operation_id = "admin_create_user",
    request_body = CreateUserRequest,
    responses(
        (status = 201, description = "The new user.", body = AdminUserRow),
        (status = 403, description = "You aren't an admin."),
        (status = 409, description = "That username is taken, ignoring case."),
        (status = 422, description = "The username or password breaks a rule; the body says which."),
    ),
)]
pub(super) async fn post_user(
    _admin: AdminUser,
    State(state): State<AppState>,
    Json(req): Json<CreateUserRequest>,
) -> Response {
    match db::auth::admin_create_user(&state.pool, &req.username, &req.password, req.permissions)
        .await
    {
        Ok(row) => (StatusCode::CREATED, Json(row)).into_response(),
        Err(AuthError::UsernameTaken) => {
            (StatusCode::CONFLICT, "username is already taken").into_response()
        }
        Err(AuthError::Validation(msg)) => (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response(),
        Err(e) => internal("create user", e),
    }
}

/// Set a user's permissions
///
/// Replaces all four permission flags. Needs an admin account.
#[utoipa::path(
    patch,
    path = "/api/admin/users/{id}/permissions",
    tag = "Admin",
    operation_id = "admin_set_user_permissions",
    params(("id" = i64, Path, description = "The user's id.")),
    request_body = UserPermissions,
    responses(
        (status = 204, description = "The permissions are saved."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No user has that id."),
        (status = 409, description = "The user is the last admin, and the change would take admin away."),
    ),
)]
pub(super) async fn patch_permissions(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(perms): Json<UserPermissions>,
) -> Response {
    match db::auth::update_user_permissions(&state.pool, id, perms).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AuthError::UserNotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(AuthError::LastAdmin) => {
            (StatusCode::CONFLICT, "cannot remove the last administrator").into_response()
        }
        Err(e) => internal("update user permissions", e),
    }
}

/// Reset a user's password
///
/// Sets a new password without asking for the old one, and signs the user out everywhere.
/// Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/admin/users/{id}/password",
    tag = "Admin",
    operation_id = "admin_set_user_password",
    params(("id" = i64, Path, description = "The user's id.")),
    request_body = SetPasswordRequest,
    responses(
        (status = 204, description = "The password is changed and the user's sessions are revoked."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No user has that id."),
        (status = 422, description = "The password breaks a rule; the body says which."),
    ),
)]
pub(super) async fn post_password(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<SetPasswordRequest>,
) -> Response {
    match db::auth::admin_set_password(&state.pool, id, &req.password).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AuthError::UserNotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(AuthError::Validation(msg)) => (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response(),
        Err(e) => internal("reset user password", e),
    }
}

/// Unlock a user
///
/// Ends a lockout from too many wrong passwords, so the user can sign in again now.
/// Succeeds when the user isn't locked too. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/admin/users/{id}/unlock",
    tag = "Admin",
    operation_id = "admin_unlock_user",
    params(("id" = i64, Path, description = "The user's id.")),
    responses(
        (status = 204, description = "The user isn't locked out."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No user has that id."),
    ),
)]
pub(super) async fn post_unlock(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match db::auth::unlock_user(&state.pool, id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AuthError::UserNotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => internal("unlock user", e),
    }
}

/// Delete a user
///
/// Deletes the account and everything that is only theirs: progress, highlights, journal
/// entries, shelves and sessions. Books they added stay in the library. This can't be
/// undone. Needs an admin account.
#[utoipa::path(
    delete,
    path = "/api/admin/users/{id}",
    tag = "Admin",
    operation_id = "admin_delete_user",
    params(("id" = i64, Path, description = "The user's id.")),
    responses(
        (status = 204, description = "The user is deleted."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "No user has that id."),
        (status = 409, description = "The user is the last admin."),
    ),
)]
pub(super) async fn delete_user(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match db::auth::delete_user(&state.pool, id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(AuthError::UserNotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(AuthError::LastAdmin) => {
            (StatusCode::CONFLICT, "cannot delete the last administrator").into_response()
        }
        Err(e) => internal("delete user", e),
    }
}

#[cfg(test)]
mod tests;
