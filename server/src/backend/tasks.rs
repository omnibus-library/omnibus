//! `GET /api/worker/status` and `GET /api/admin/background-tasks`: the live
//! background-task feed and the recorded run history behind the Maintenance
//! screen. REST twins of `rpc_worker_status` and `rpc_get_background_tasks`;
//! the feed is scoped to its caller, the history is admin-only.

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db::{self as db, background_tasks::RECENT_TASKS_LIMIT};
use omnibus_shared::{BackgroundTaskRecord, WorkerStatus};

use super::{internal, AppState};
use crate::auth::{AdminUser, AuthUser};

/// Get the background task feed
///
/// The background tasks running now and those that finished in the last 10 seconds or so,
/// for a progress display to poll. A task one user started, such as a Send to Kindle,
/// shows only to that user.
#[utoipa::path(
    get,
    path = "/api/worker/status",
    tag = "Admin",
    responses(
        (status = 200, description = "The task feed.", body = WorkerStatus),
    ),
)]
pub(super) async fn get_worker_status(
    user: AuthUser,
    State(state): State<AppState>,
) -> Json<WorkerStatus> {
    Json(state.worker.owner_scoped_snapshot(user.id))
}

/// List recent background tasks
///
/// The most recent recorded runs of background tasks, newest first, up to 100. Each has its
/// kind, status and timing and, for a failed run, why it failed. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/admin/background-tasks",
    tag = "Admin",
    responses(
        (status = 200, description = "The recorded runs.", body = Vec<BackgroundTaskRecord>),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_background_tasks(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> Response {
    match db::background_tasks::recent_tasks(&state.pool, RECENT_TASKS_LIMIT).await {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => internal("recent background tasks", error),
    }
}

#[cfg(test)]
mod tests;
