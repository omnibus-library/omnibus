//! Time-of-day and day-of-week rollups for [`super::user_stats`]: how the
//! window's reading and listening seconds distribute across the 24 hours of a
//! day and the 7 days of a week, zero-filled to their full width so the shape
//! of a day stays legible instead of collapsing to the hours that happened to
//! have activity.
//!
//! # Timezone
//!
//! **Local-time**, from the offset each session recorded at capture
//! (`SessionReport::utc_offset_minutes`, migration 0080), applied to the
//! timestamp before bucketing; `db::stats` cuts days on the reader's offset.
//! **Rows with no offset are excluded, not defaulted** — a pre-0080 row says
//! nothing about where the reader was — and come back as
//! [`TimePatterns::unzoned_seconds`] instead. Rationale in
//! `.claude/rules/10-reader-calendar.md`.

use omnibus_shared::{HourBucket, WeekdayBucket};
use sqlx::{Row, SqlitePool};

use super::StatsError;

/// Hours in a day / days in a week — the fixed widths both strips zero-fill
/// to.
const HOURS: usize = 24;
const WEEKDAYS: usize = 7;

/// Weekday column labels, Monday first. The server owns these (rather than
/// letting each client name index 0) because week-start is a convention: a
/// client assuming Sunday-first would draw every column one place out and
/// nothing would fail.
const WEEKDAY_LABELS: [&str; WEEKDAYS] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/// The session union these rollups share: one `(started_at, offset, secs)` row per
/// reading and listening session in the window, counted both formats alike. Shared
/// with [`super::goals`], which buckets the same rows into a local *day*, so the
/// daily goal and the time-pattern strips describe the same sessions. Bind order is
/// `user_id, start, user_id, start`.
// Checkpoint rows are bucketed as written, which is correct: the web tracker's
// `rollover()` restarts a segment every 60s, so a sit spanning an hour boundary
// already arrives as two rows. Coalescing must not credit it all to its start hour.
pub(super) const SESSION_LOCAL_ROWS: &str = "\
    SELECT started_at, utc_offset_minutes, seconds_read AS secs FROM reading_sessions \
        WHERE user_id = ? AND started_at >= ? \
    UNION ALL \
    SELECT started_at, utc_offset_minutes, seconds_listened FROM listening_sessions \
        WHERE user_id = ? AND started_at >= ?";

/// Both time-pattern strips plus the seconds neither could place.
#[derive(Debug)]
pub(super) struct TimePatterns {
    /// All 24 local hours, ascending, zeros included.
    pub hour_of_day: Vec<HourBucket>,
    /// All 7 local weekdays, Monday first, zeros included.
    pub day_of_week: Vec<WeekdayBucket>,
    /// Seconds in the window from sessions carrying no capture-time offset.
    pub unzoned_seconds: i64,
}

/// Roll the window's sessions up by local hour of day and local weekday, in one
/// `GROUP BY` over the shared union so the two strips describe the same sessions.
/// Sessions with no recorded offset are summed into [`TimePatterns::unzoned_seconds`]
/// rather than bucketed (see the module docs).
pub(super) async fn time_patterns(
    pool: &SqlitePool,
    user_id: i64,
    start: i64,
) -> Result<TimePatterns, StatsError> {
    let (hours, weekdays) = zoned_buckets(pool, user_id, start).await?;
    Ok(TimePatterns {
        hour_of_day: hours
            .iter()
            .enumerate()
            .map(|(hour, &seconds)| HourBucket {
                // 0..=23 by construction.
                hour: hour as i64,
                seconds,
            })
            .collect(),
        day_of_week: weekdays
            .iter()
            .enumerate()
            .map(|(weekday, &seconds)| WeekdayBucket {
                // 0..=6 by construction.
                weekday: weekday as i64,
                label: WEEKDAY_LABELS[weekday].to_string(),
                seconds,
            })
            .collect(),
        unzoned_seconds: unzoned_seconds(pool, user_id, start).await?,
    })
}

/// The two zero-filled tallies, keyed by local hour and Monday-first weekday.
async fn zoned_buckets(
    pool: &SqlitePool,
    user_id: i64,
    start: i64,
) -> Result<([i64; HOURS], [i64; WEEKDAYS]), StatsError> {
    // Shift the timestamp, not the aggregate: `started_at + offset * 60` as `'unixepoch'`
    // is the device's wall clock, and rotating 24 whole-hour buckets cannot represent
    // UTC+05:30 or UTC+05:45.
    let sql = format!(
        "SELECT CAST(strftime('%H', started_at + utc_offset_minutes * 60, 'unixepoch')
                     AS INTEGER) AS hour,
                CAST(strftime('%w', started_at + utc_offset_minutes * 60, 'unixepoch')
                     AS INTEGER) AS dow,
                SUM(secs) AS seconds
         FROM ({SESSION_LOCAL_ROWS})
         WHERE utc_offset_minutes IS NOT NULL
         GROUP BY hour, dow"
    );
    let rows = sqlx::query(&sql)
        .bind(user_id)
        .bind(start)
        .bind(user_id)
        .bind(start)
        .fetch_all(pool)
        .await?;

    let mut hours = [0_i64; HOURS];
    let mut weekdays = [0_i64; WEEKDAYS];
    for row in rows {
        let seconds: i64 = row.get("seconds");
        // `strftime` yields NULL for a timestamp it can't render; a row that
        // can't be placed on a clock is dropped rather than folded into
        // midnight-Monday, which is a real bucket a reader would believe.
        let (Ok(hour), Ok(dow)) = (row.try_get::<i64, _>("hour"), row.try_get::<i64, _>("dow"))
        else {
            continue;
        };
        if let Some(slot) = usize::try_from(hour).ok().and_then(|h| hours.get_mut(h)) {
            *slot += seconds;
        }
        // SQLite's `%w` is 0 = Sunday; the wire order is Monday first.
        if let Some(slot) = usize::try_from((dow + 6) % 7)
            .ok()
            .and_then(|d| weekdays.get_mut(d))
        {
            *slot += seconds;
        }
    }
    Ok((hours, weekdays))
}

/// Seconds in the window from sessions that recorded no UTC offset — the
/// total the two strips are *not* drawn over.
async fn unzoned_seconds(pool: &SqlitePool, user_id: i64, start: i64) -> Result<i64, StatsError> {
    let sql = format!(
        "SELECT COALESCE(SUM(secs), 0) FROM ({SESSION_LOCAL_ROWS}) \
         WHERE utc_offset_minutes IS NULL"
    );
    Ok(sqlx::query_scalar(&sql)
        .bind(user_id)
        .bind(start)
        .bind(user_id)
        .bind(start)
        .fetch_one(pool)
        .await?)
}

#[cfg(test)]
mod tests;
