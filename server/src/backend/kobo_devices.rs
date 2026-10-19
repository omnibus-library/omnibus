//! REST handlers for the signed-in reader's Kobo e-readers: list, register, rotate a
//! device's sync token, and remove it. Mirrors the web server functions in
//! `frontend/src/rpc/kobo.rs` over the same `db::kobo_devices` calls. Every query is
//! scoped to the caller's id, so another reader's device is indistinguishable from an
//! unknown one (404).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, kobo_devices::KoboDeviceError};
use omnibus_shared::{kobo_device_name_invalid, CreateKoboDevice, KoboDeviceView};

use crate::auth::AuthUser;

use super::{internal, AppState};

/// A missing device is the caller's 404; anything else is a server fault.
fn failed(context: &'static str, e: KoboDeviceError) -> Response {
    match e {
        KoboDeviceError::NotFound => {
            (StatusCode::NOT_FOUND, "kobo device not found").into_response()
        }
        other => internal(context, other),
    }
}

/// List your Kobo devices
///
/// The Kobo e-readers registered to your account, with the secret each one syncs with.
#[utoipa::path(
    get,
    path = "/api/account/kobo-devices",
    tag = "Account",
    responses(
        (status = 200, description = "Your Kobo devices.", body = Vec<KoboDeviceView>),
    ),
)]
pub(super) async fn list_kobo_devices(user: AuthUser, State(state): State<AppState>) -> Response {
    match db::kobo_devices::list_devices(&state.pool, user.id).await {
        Ok(list) => Json(
            list.into_iter()
                .map(KoboDeviceView::from)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => failed("list kobo devices", e),
    }
}

/// Register a Kobo device
///
/// Adds a Kobo under the given label and mints the token its sync address
/// `/kobo/{token}/…` carries.
#[utoipa::path(
    post,
    path = "/api/account/kobo-devices",
    tag = "Account",
    request_body = CreateKoboDevice,
    responses(
        (status = 200, description = "The new device, with its token.", body = KoboDeviceView),
        (status = 422, description = "The name is empty or longer than 100 characters once trimmed."),
    ),
)]
pub(super) async fn create_kobo_device(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateKoboDevice>,
) -> Response {
    if kobo_device_name_invalid(&body.name) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            "enter a device name (1–100 characters)",
        )
            .into_response();
    }
    match db::kobo_devices::create_device(&state.pool, user.id, body.name.trim()).await {
        Ok(device) => Json(KoboDeviceView::from(device)).into_response(),
        Err(e) => failed("create kobo device", e),
    }
}

/// Regenerate a Kobo's token
///
/// Replaces the device's token, so its old sync address stops working at once. The
/// device keeps its name and its sync progress; point the Kobo at the new address.
#[utoipa::path(
    post,
    path = "/api/account/kobo-devices/{id}/regenerate",
    tag = "Account",
    params(("id" = i64, Path, description = "The device's id.")),
    responses(
        (status = 200, description = "The device, with its new token.", body = KoboDeviceView),
        (status = 404, description = "None of your devices has that id."),
    ),
)]
pub(super) async fn regenerate_kobo_device(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match db::kobo_devices::regenerate_token(&state.pool, user.id, id).await {
        Ok(device) => Json(KoboDeviceView::from(device)).into_response(),
        Err(e) => failed("regenerate kobo device", e),
    }
}

/// Remove a Kobo device
///
/// Deletes the registration, so the Kobo's sync address stops working.
#[utoipa::path(
    delete,
    path = "/api/account/kobo-devices/{id}",
    tag = "Account",
    params(("id" = i64, Path, description = "The device's id.")),
    responses(
        (status = 204, description = "The device is removed."),
        (status = 404, description = "None of your devices has that id."),
    ),
)]
pub(super) async fn delete_kobo_device(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Response {
    match db::kobo_devices::revoke_device(&state.pool, user.id, id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => failed("delete kobo device", e),
    }
}

#[cfg(test)]
mod tests;
