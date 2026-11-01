//! REST handlers for the signed-in reader's Kobo and KOReader devices: list, register, rotate a
//! device's sync token, and remove it. Every query is scoped to the caller's id, so
//! another reader's device is indistinguishable from an unknown one (404).

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, kobo_devices::KoboDeviceError};
use omnibus_shared::{
    kobo_device_name_invalid, kobo_device_name_message, CreateKoboDevice, DeviceKind, FileBytes,
    KoboDeviceView,
};

use crate::auth::AuthUser;

use super::kobo::origin_for;
use super::koreader::plugin::plugin_zip;
use super::{deny_without_download, internal, AppState};

/// A missing device is the caller's 404; anything else is a server fault.
fn failed(context: &'static str, e: KoboDeviceError) -> Response {
    match e {
        KoboDeviceError::NotFound => {
            (StatusCode::NOT_FOUND, "kobo device not found").into_response()
        }
        other => internal(context, other),
    }
}

/// List your sync devices
///
/// The Kobo and KOReader devices registered to your account, each with its kind and the
/// secret it syncs with.
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

/// Register a sync device
///
/// Adds a Kobo, a KOReader or a no-plugin KOReader (`kosync`) under the given label and
/// mints its token. A Kobo is a Kobo when `kind` is omitted, and its sync address is
/// `/kobo/{token}/…`. A `kosync` device authenticates nothing itself: it stands for a
/// KOReader signed in to Progress sync, which uses one login per account. The first
/// `kosync` device on an account with no Progress sync login creates it and returns it in
/// `kosync_login`, shown only in that response; later ones reuse the login and return none.
#[utoipa::path(
    post,
    path = "/api/account/kobo-devices",
    tag = "Account",
    request_body = CreateKoboDevice,
    responses(
        (status = 200, description = "The new device, with its token.", body = KoboDeviceView),
        (status = 422, description = "The name is empty or longer than 100 characters once trimmed, or `kind` is not `kobo`, `koreader` or `kosync`."),
    ),
)]
pub(super) async fn create_kobo_device(
    user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateKoboDevice>,
) -> Response {
    if kobo_device_name_invalid(&body.name) {
        return (StatusCode::UNPROCESSABLE_ENTITY, kobo_device_name_message()).into_response();
    }
    match db::kobo_devices::register_device(&state.pool, user.id, body.name.trim(), body.kind).await
    {
        Ok((device, kosync_login)) => Json(KoboDeviceView {
            kosync_login,
            ..KoboDeviceView::from(device)
        })
        .into_response(),
        Err(e) => failed("create kobo device", e),
    }
}

/// Regenerate a device's token
///
/// Replaces the device's token, so its old token stops working at once. The
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

/// Remove a sync device
///
/// Deletes the registration, so the device's token stops working. Removing your last
/// no-plugin KOReader (`kosync`) also turns off your Progress sync password, so it stops
/// working too. Removing any other device leaves that password alone.
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

/// Download a KOReader's plugin
///
/// The Omnibus plugin for one of your KOReaders, as a zip already set to this server and
/// carrying that KOReader's token. Unzip it into KOReader's `plugins` folder. The zip holds
/// the token, so treat the file like a password. Needs the download permission.
#[utoipa::path(
    get,
    path = "/api/account/kobo-devices/{id}/koreader-plugin",
    tag = "Account",
    params(("id" = i64, Path, description = "The KOReader's id.")),
    responses(
        (status = 200, description = "The plugin, zipped.", body = FileBytes, content_type = "application/zip",
            headers(("Content-Disposition" = String, description = "`attachment`, with the file name."))),
        (status = 403, description = "Your account lacks the download permission."),
        (status = 404, description = "No KOReader of yours has that id."),
    ),
)]
pub(super) async fn download_koreader_plugin(
    user: AuthUser,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Response {
    if let Some(denied) = deny_without_download(&user) {
        return denied;
    }
    let device = match db::kobo_devices::get_device_for_user(&state.pool, user.id, id).await {
        Ok(Some(device)) if device.kind == DeviceKind::Koreader => device,
        Ok(_) => return (StatusCode::NOT_FOUND, "koreader not found").into_response(),
        Err(e) => return failed("get koreader device", e),
    };
    let disposition = format!("attachment; filename=\"omnibus-koreader-{id}.zip\"");
    match plugin_zip(&origin_for(&headers, &state.public_origins), &device.token) {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "application/zip"),
                (header::CONTENT_DISPOSITION, disposition.as_str()),
                (header::CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => internal("build koreader plugin zip", e),
    }
}

#[cfg(test)]
mod tests;
