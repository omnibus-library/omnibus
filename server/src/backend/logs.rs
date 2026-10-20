//! `GET /api/admin/logs`, the admin log viewer's read over the on-disk logs.
//! The REST twin of `rpc_get_logs`, `AdminUser`-gated.

use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use omnibus_db as db;
use omnibus_shared::logs::{LogPage, LogQuery};

use crate::auth::AdminUser;

use super::internal;

/// Read the server logs
///
/// One page of the server's log records, newest first, narrowed by level, module and
/// time range. Needs an admin account.
#[utoipa::path(
    get,
    path = "/api/admin/logs",
    tag = "Admin",
    params(LogQuery),
    responses(
        (status = 200, description = "The matching records.", body = LogPage),
        (status = 400, description = "A query parameter is malformed, such as a `page` that isn't a whole number."),
        (status = 403, description = "You aren't an admin."),
    ),
)]
pub(super) async fn get_logs(_admin: AdminUser, Query(query): Query<LogQuery>) -> Response {
    match db::logs::read_logs(&db::logs::log_dir(), &query).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => internal("read logs", error),
    }
}

#[cfg(test)]
mod tests;
