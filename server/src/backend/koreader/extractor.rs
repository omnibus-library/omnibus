//! `KoreaderDevice` — the `Authorization: Bearer` extractor for the KOReader routes.
//! The token is the per-device `kobo_devices` credential of a KOReader row, never a
//! session token, and it travels in a header only so no URL or log line carries it.

use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts, StatusCode},
    response::{IntoResponse, Response},
};
use omnibus_db as db;
use omnibus_shared::DeviceKind;

use crate::backend::AppState;
use crate::http_errors::internal;

/// The device a request authenticated as, and the user that owns it.
pub struct KoreaderDevice {
    pub user_id: i64,
    pub device_id: i64,
}

impl FromRequestParts<AppState> for KoreaderDevice {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(unauthorized)?;
        match db::kobo_devices::resolve_device_by_token(state.pool(), token, DeviceKind::Koreader)
            .await
        {
            Ok(Some(r)) => Ok(Self {
                user_id: r.user_id,
                device_id: r.device_id,
            }),
            Ok(None) => Err(unauthorized()),
            Err(e) => Err(internal("koreader extractor", e)),
        }
    }
}

fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, "unauthorized").into_response()
}
