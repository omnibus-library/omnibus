//! Admin REST handlers for the book-request connections: the Prowlarr and download client
//! settings. Every route answers 404 while the book-requests flag is off, before any
//! auth check, so an off server shows nothing of the feature even to its admins.

use axum::{
    extract::{FromRequestParts, State},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db as db;
use omnibus_shared::{RequestsSettingsStatus, RequestsSettingsUpdate};

use super::{internal, AppState};
use crate::auth::AdminUser;

/// An admin on a server with book requests on. The flag is checked first, so with it off
/// the answer is 404 for everyone, not the 401 or 403 the auth check would give.
pub(super) struct RequestsAdmin;

impl FromRequestParts<AppState> for RequestsAdmin {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if !state.book_requests() {
            return Err(StatusCode::NOT_FOUND.into_response());
        }
        AdminUser::from_request_parts(parts, state).await?;
        Ok(RequestsAdmin)
    }
}

/// Get the request connections
///
/// The Prowlarr and download client settings, with the API key and password masked.
/// Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/admin/requests/settings",
    tag = "Admin",
    operation_id = "get_requests_settings",
    responses(
        (status = 200, description = "The connections.", body = RequestsSettingsStatus),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "Book requests are off on this server."),
    ),
)]
pub(super) async fn get_requests_settings(
    _admin: RequestsAdmin,
    State(state): State<AppState>,
) -> Response {
    match db::requests_settings_status(&state.pool).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => internal("read requests settings", e),
    }
}

/// Save the request connections
///
/// Sets the Prowlarr and download client connections. Every field replaces the saved
/// value, except the two secrets, which keep theirs when left out. Needs an admin account.
#[utoipa::path(
    put,
    path = "/api/admin/requests/settings",
    tag = "Admin",
    operation_id = "set_requests_settings",
    request_body = RequestsSettingsUpdate,
    responses(
        (status = 200, description = "The connections are saved; the body is what is now set.", body = RequestsSettingsStatus),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "Book requests are off on this server."),
        (status = 422, description = "A URL isn't an `http` or `https` address without a login in it, or a field is over its length limit; the body says which."),
    ),
)]
pub(super) async fn put_requests_settings(
    _admin: RequestsAdmin,
    State(state): State<AppState>,
    Json(update): Json<RequestsSettingsUpdate>,
) -> Response {
    match db::set_requests_settings(&state.pool, &update).await {
        Ok(()) => {}
        Err(db::SettingsError::Validation(msg)) => {
            return (StatusCode::UNPROCESSABLE_ENTITY, msg).into_response();
        }
        Err(e) => return internal("save requests settings", e),
    }
    match db::requests_settings_status(&state.pool).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => internal("read requests settings", e),
    }
}

#[cfg(test)]
mod tests;
