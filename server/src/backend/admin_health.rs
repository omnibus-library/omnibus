//! `GET /api/admin/health` handler — the first admin route in the app.
//! Aggregates index status, worker queue, FTS health, storage, and the
//! in-memory error ring into one `AdminHealthReport`. `AdminUser`-gated;
//! the mobile-facing REST twin of `rpc_get_admin_health`, both calling
//! `db::admin_health::build_report` so the two surfaces can't drift.

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db as db;
use omnibus_shared::AdminHealthReport;

use super::{internal, AppState};
use crate::auth::AdminUser;

/// Get the server health report
///
/// One snapshot of the library index, the background task queue, the search index, disk
/// use and the most recent errors. Poll it to keep a view current. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/admin/health",
    tag = "Admin",
    responses(
        (status = 200, description = "The health report.", body = AdminHealthReport),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_admin_health(_admin: AdminUser, State(state): State<AppState>) -> Response {
    // The web page's live-update loop polls `rpc_get_admin_health`, not this REST twin.
    match db::admin_health::build_report(state.pool(), state.worker()).await {
        Ok(report) => Json(report).into_response(),
        Err(error) => internal("admin health report", error),
    }
}

#[cfg(test)]
mod tests;
