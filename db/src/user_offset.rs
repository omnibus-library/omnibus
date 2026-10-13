//! The reader's UTC offset — the single calendar every day-boundary figure in
//! `crate::stats` is cut on.
//!
//! A day is *ordinal*: today, yesterday, seven in a row. A sequence whose
//! elements are measured on different calendars cannot be ordered, so every
//! figure with a day boundary — the heatmap, the streak, both daily goals, the
//! Week/Month/Year window edges — resolves against **one** offset per request:
//! the one the asking client declares, falling back to the reader's most recent
//! session and finally to UTC.
//!
//! Which *hour* a session sits in is a different question and takes a different
//! answer — the offset that session recorded at capture time, so an evening read
//! in Tokyo stays an evening after the reader flies home. That lives in
//! `crate::stats::patterns` and is deliberately not this.

use omnibus_shared::SessionReport;
use sqlx::{Row, SqlitePool};

#[cfg(test)]
mod tests;

/// Failure space of the offset lookups: each is a query, so a wrapped
/// `sqlx::Error` is the only way they fail. An enum rather than a bare
/// `sqlx::Error` so no raw DB error crosses the module boundary.
#[derive(Debug, thiserror::Error)]
pub enum OffsetError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

/// The offset this request's day boundaries are cut on, in minutes east of UTC.
/// Prefers what the asking client declared, falling back to the offset of their
/// most recent session, then to UTC (`0`: what a day gets called when nobody can
/// say better, not a claim the reader is at UTC). An out-of-range claim is
/// discarded rather than rejected: every caller is a read path that should degrade.
pub async fn resolve_offset_minutes(
    pool: &SqlitePool,
    user_id: i64,
    claimed: Option<i64>,
) -> Result<i64, OffsetError> {
    if let Some(offset) = claimed.filter(|o| in_range(*o)) {
        return Ok(offset);
    }
    Ok(current_offset_minutes(pool, user_id).await?.unwrap_or(0))
}

/// Whether `offset` is a real IANA offset — UTC-12:00 through UTC+14:00. Bounds
/// shared with [`SessionReport::validate`] so the API boundary and the read path
/// cannot come to disagree about what a plausible offset is.
fn in_range(offset: i64) -> bool {
    (SessionReport::UTC_OFFSET_MIN_MINUTES..=SessionReport::UTC_OFFSET_MAX_MINUTES)
        .contains(&offset)
}

/// The reader's UTC offset from the most recent session carrying a plausible one,
/// or `None` when no session ever has. A **proxy**: where they were when they last
/// read, not where they are now, and stale by an hour after a DST transition they
/// haven't read across. Only reached when the client declared no offset.
pub async fn current_offset_minutes(
    pool: &SqlitePool,
    user_id: i64,
) -> Result<Option<i64>, OffsetError> {
    // One indexed probe per table, compared here, not an `ORDER BY` over a `UNION ALL`:
    // SQLite can't push the sort through the union and would sort a reader's whole
    // offset-carrying history on every stats load.
    let mut latest: Option<(i64, i64)> = None;
    // Range-checked inside each probe rather than on the winner: rows written
    // before `SessionReport::validate` existed are still here, and one of them
    // landing last must cost the reader that session, not their whole calendar.
    // `BETWEEN` excludes a NULL too, so a probe only ever decodes an offset.
    for table in ["reading_sessions", "listening_sessions"] {
        // `table` is one of two fixed literals chosen here, never user input,
        // and the bounds are `i64` consts — neither is an injection surface.
        let sql = format!(
            "SELECT started_at, utc_offset_minutes FROM {table}
             WHERE user_id = ? AND utc_offset_minutes BETWEEN {min} AND {max}
             ORDER BY started_at DESC LIMIT 1",
            min = SessionReport::UTC_OFFSET_MIN_MINUTES,
            max = SessionReport::UTC_OFFSET_MAX_MINUTES,
        );
        let Some(row) = sqlx::query(&sql).bind(user_id).fetch_optional(pool).await? else {
            continue;
        };
        let candidate: (i64, i64) = (
            row.try_get("started_at")?,
            row.try_get("utc_offset_minutes")?,
        );
        if latest.is_none_or(|(seen, _)| candidate.0 > seen) {
            latest = Some(candidate);
        }
    }
    Ok(latest.map(|(_, offset)| offset))
}

/// Today's date as `YYYY-MM-DD` under `offset_minutes`.
///
/// Read from SQLite rather than the process clock so it lands on the same "now"
/// every other window boundary in `crate::stats` is cut on.
pub async fn today(pool: &SqlitePool, offset_minutes: i64) -> Result<String, OffsetError> {
    Ok(sqlx::query_scalar(
        "SELECT date(CAST(strftime('%s','now') AS INTEGER) + ? * 60, 'unixepoch')",
    )
    .bind(offset_minutes)
    .fetch_one(pool)
    .await?)
}
