//! Admin REST handlers for the book-request connections: the Prowlarr and download client
//! settings, and a test button for each. Every route answers 404 while the book-requests
//! flag is off, before the admin check (403), so an off server shows nothing of the feature
//! even to its admins.

use axum::{
    extract::{FromRequestParts, State},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{
    self as db,
    requests::{
        clients::{client_for, DownloadClient},
        prowlarr::Prowlarr,
        ConnectionError,
    },
};
use omnibus_shared::{RequestsSettingsStatus, RequestsSettingsUpdate};

use crate::auth::AdminUser;

use super::{internal, AppState};

/// An admin on a server with book requests on. The flag is checked before the admin check,
/// so with it off the answer is 404 for a signed-in caller, not the 403 the admin check gives.
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

/// Test the Prowlarr connection
///
/// Calls Prowlarr with the saved address and API key and reports whether it answered. It
/// changes nothing. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/admin/requests/settings/test-indexer",
    tag = "Admin",
    operation_id = "test_prowlarr_connection",
    responses(
        (status = 200, description = "Prowlarr answered and accepted the API key."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "Book requests are off on this server."),
        (status = 409, description = "The Prowlarr address or API key isn't set."),
        (status = 502, description = "Prowlarr didn't answer or refused the call; the body says why."),
    ),
)]
pub(super) async fn post_test_indexer(
    _admin: RequestsAdmin,
    State(state): State<AppState>,
) -> Response {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err(res) => return res,
    };
    connection_response(async { Prowlarr::from_config(&config)?.test().await }.await)
}

/// Test the download client connection
///
/// Logs in to the download client with the saved address and login and reports whether it
/// answered. It changes nothing. Needs an admin account.
#[utoipa::path(
    post,
    path = "/api/admin/requests/settings/test-client",
    tag = "Admin",
    operation_id = "test_download_client_connection",
    responses(
        (status = 200, description = "The download client answered and accepted the login."),
        (status = 403, description = "You aren't an admin."),
        (status = 404, description = "Book requests are off on this server."),
        (status = 409, description = "The download client address isn't set."),
        (status = 502, description = "The download client didn't answer or refused the call; the body says why."),
    ),
)]
pub(super) async fn post_test_client(
    _admin: RequestsAdmin,
    State(state): State<AppState>,
) -> Response {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err(res) => return res,
    };
    connection_response(async { client_for(&config)?.test().await }.await)
}

/// The saved connections, or the 500 to answer with when they can't be read.
async fn load_config(state: &AppState) -> Result<db::RequestsConfig, Response> {
    db::effective_requests_config(&state.pool)
        .await
        .map_err(|e| internal("read requests settings", e))
}

/// 200 on success, 409 when unset, else 502 with the plain reason. A [`ConnectionError`]
/// never carries a URL or secret, so its text is safe to send back.
fn connection_response(result: Result<(), ConnectionError>) -> Response {
    match result {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e @ ConnectionError::NotConfigured) => {
            (StatusCode::CONFLICT, e.to_string()).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

#[cfg(test)]
mod tests;
