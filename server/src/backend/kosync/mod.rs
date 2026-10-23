//! The `/kosync/*` routes: the progress half of KOReader's sync-server protocol, so a stock
//! KOReader with no plugin can sync a position with Omnibus. Mounted outside `/api/*` and
//! out of the REST contract, like `/kobo` and `/koreader/v1`; each route authenticates through
//! [`auth::KosyncUser`]. Every route checks the `Accept` header first, then credentials, then
//! the body, and answers errors as `{"code", "message"}` the way KOReader's server does.

use std::sync::Arc;

use axum::{
    extract::Request,
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Extension, Json, Router,
};
use serde_json::json;

use super::AppState;

mod auth;
mod progress;
#[cfg(test)]
mod tests;

/// The media type every KOReader sync request names in `Accept`.
const KOREADER_ACCEPT: &str = "application/vnd.koreader.v1+json";

/// Build the kosync router.
pub fn kosync_router(state: AppState) -> Router {
    let failures = Arc::new(auth::AuthFailures::new(state.rate_limits()));
    Router::new()
        .route("/kosync/users/create", post(create_user))
        .route("/kosync/users/auth", get(authorize))
        .route("/kosync/syncs/progress", put(progress::put_progress))
        .route(
            "/kosync/syncs/progress/{document}",
            get(progress::get_progress),
        )
        .layer(middleware::from_fn(require_koreader_accept))
        .layer(Extension(failures))
        .with_state(state)
}

/// An error in KOReader's sync-server shape; KOReader shows `message` to the reader.
fn error(status: StatusCode, code: u32, message: &str) -> Response {
    (status, Json(json!({ "code": code, "message": message }))).into_response()
}

/// Refuse a request whose `Accept` does not name the KOReader media type, as the stock server does.
async fn require_koreader_accept(req: Request, next: Next) -> Response {
    let named = req
        .headers()
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains(KOREADER_ACCEPT));
    if !named {
        return error(
            StatusCode::PRECONDITION_FAILED,
            101,
            "Invalid Accept header format.",
        );
    }
    next.run(req).await
}

/// Registration is refused: the password is generated in Omnibus, never made on the device.
async fn create_user() -> Response {
    error(
        StatusCode::FORBIDDEN,
        2005,
        "Create a sync password in Omnibus under Settings \u{203a} Devices.",
    )
}

/// KOReader's login check: the credentials already passed [`auth::KosyncUser`].
async fn authorize(_user: auth::KosyncUser) -> Response {
    Json(json!({ "authorized": "OK" })).into_response()
}
