//! Durable history of background worker task runs.
//!
//! The `background_tasks` table is the on-disk companion to the worker's
//! in-memory progress map: `start_task` once a task begins, `finish_task` once
//! it reaches a terminal state, and `recent_tasks` backing the admin dashboard.

use sqlx::{Row, SqlitePool};

pub use omnibus_shared::worker::{BackgroundTaskRecord, BackgroundTaskStatus};

/// Cap on the rows the admin history returns — enough history for an operator to spot a
/// pattern without an unbounded response. Both the RPC and the REST route read it.
pub const RECENT_TASKS_LIMIT: i64 = 100;

/// Column list shared by every row-returning query, matched by [`row_to_record`].
const COLS: &str = "id, task_kind, status, started_at, finished_at, error";

/// Failure space for background-task persistence queries. A single
/// transparent variant: every caller here just propagates or logs, none
/// branches on the failure mode (`.claude/rules/02-error-handling.md`).
#[derive(Debug, thiserror::Error)]
pub enum BackgroundTaskError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

/// Insert a `running` row for a task that just started, returning its
/// autoincrement id — the handle a later [`finish_task`] call updates.
pub async fn start_task(
    pool: &SqlitePool,
    task_kind: &str,
    started_at: i64,
) -> Result<i64, BackgroundTaskError> {
    let row = sqlx::query(
        "INSERT INTO background_tasks (task_kind, status, started_at) \
         VALUES (?, 'running', ?) RETURNING id",
    )
    .bind(task_kind)
    .bind(started_at)
    .fetch_one(pool)
    .await?;
    Ok(row.get("id"))
}

/// Update a task row to its terminal state, recording the finish time and, for
/// `Err`, the error text. A no-op, not an error, if `id` no longer exists: the
/// row is best-effort observability the worker's success doesn't depend on.
pub async fn finish_task(
    pool: &SqlitePool,
    id: i64,
    finished_at: i64,
    outcome: Result<(), &str>,
) -> Result<(), BackgroundTaskError> {
    // A `Result`, not a `(status, error)` pair: a terminal write cannot name
    // `Running`, and an error string cannot ride along with a success.
    let (status, error) = match outcome {
        Ok(()) => (BackgroundTaskStatus::Success, None),
        Err(msg) => (BackgroundTaskStatus::Failed, Some(msg)),
    };
    sqlx::query("UPDATE background_tasks SET status = ?, finished_at = ?, error = ? WHERE id = ?")
        .bind(status.as_db_str())
        .bind(finished_at)
        .bind(error)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Fetch the most recent `limit` task rows, newest first — the admin
/// dashboard's whole read pattern (AC3).
pub async fn recent_tasks(
    pool: &SqlitePool,
    limit: i64,
) -> Result<Vec<BackgroundTaskRecord>, BackgroundTaskError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLS} FROM background_tasks ORDER BY id DESC LIMIT ?"
    ))
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_record).collect())
}

/// Map one `background_tasks` row to its wire record. An unparseable `status`
/// (a newer build's value, or manual DB surgery) is logged and falls back to
/// `Running`, so one corrupted row never hard-fails the dashboard read.
fn row_to_record(row: &sqlx::sqlite::SqliteRow) -> BackgroundTaskRecord {
    let id: i64 = row.get("id");
    let status_raw: String = row.get("status");
    let status = status_raw.parse().unwrap_or_else(|_| {
        tracing::warn!(
            id,
            status = %status_raw,
            "background_tasks: row has an unrecognized status, defaulting to Running"
        );
        BackgroundTaskStatus::Running
    });
    BackgroundTaskRecord {
        id,
        task_kind: row.get("task_kind"),
        status,
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
        error: row.get("error"),
    }
}

#[cfg(test)]
mod tests;
