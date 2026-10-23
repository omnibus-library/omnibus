//! `/api/account/kosync` — the signed-in reader's KOReader progress-sync password. Mirrors the
//! web server functions in `frontend::rpc::kosync` over the same `db::kosync` calls.

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db as db;
use omnibus_shared::{KosyncPassword, KosyncStatus};

use super::{internal, AppState};
use crate::auth::AuthUser;

/// Check your KOReader sync password
///
/// Whether you have generated a password for stock KOReader's Progress sync. The password
/// itself cannot be read back, only replaced.
#[utoipa::path(
    get,
    path = "/api/account/kosync",
    tag = "Account",
    responses(
        (status = 200, description = "Whether a password exists.", body = KosyncStatus),
    ),
)]
pub(super) async fn get_kosync(user: AuthUser, State(state): State<AppState>) -> Response {
    match db::kosync::kosync_configured(&state.pool, user.id).await {
        Ok(configured) => Json(KosyncStatus { configured }).into_response(),
        Err(e) => internal("read kosync status", e),
    }
}

/// Generate a KOReader sync password
///
/// Creates the password stock KOReader's Progress sync signs in with, together with your
/// username, and shows it once. Generating again replaces it, so the old one stops working.
#[utoipa::path(
    post,
    path = "/api/account/kosync",
    tag = "Account",
    responses(
        (status = 200, description = "The new password, shown only in this response.", body = KosyncPassword),
    ),
)]
pub(super) async fn post_kosync(user: AuthUser, State(state): State<AppState>) -> Response {
    match db::kosync::generate_kosync_password(&state.pool, user.id).await {
        Ok(password) => Json(KosyncPassword {
            username: user.username,
            password,
        })
        .into_response(),
        Err(e) => internal("generate kosync password", e),
    }
}

#[cfg(test)]
mod tests;
