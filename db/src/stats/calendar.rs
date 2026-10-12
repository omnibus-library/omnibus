//! SQLite expression builders for the reader's calendar — the one place a UTC
//! timestamp becomes a local day, month, or window edge.
//!
//! Every day-boundary rollup in `super` composes its SQL from these rather than
//! spelling out its own shift, so a reader's Tuesday is the same Tuesday in the
//! heatmap, the streak, the pages tile and the window the three are cut to. A
//! second hand-written `date(started_at + …)` is how those come to disagree.
//!
//! # Why the offset is interpolated, not bound
//!
//! It arrives as an `i64` that `crate::user_offset::resolve_offset_minutes` has
//! already forced into `-720..=840` — and that [`bounded`] re-applies here, so
//! the argument rests on this module rather than on every caller. There is no
//! string to escape and no injection surface. Binding it instead would mean
//! threading two extra placeholders through every call site's bind order —
//! which is exactly the kind of positional bookkeeping that silently mis-binds
//! a query.

use omnibus_shared::{SessionReport, StatsRange};

#[cfg(test)]
mod tests;

/// The offset held to the range `crate::user_offset::resolve_offset_minutes`
/// already guarantees, so the invariant this module's SQL rests on is enforced
/// where it is used. Applied by both builders: a bounded shift paired with an
/// unbounded modifier would put [`window_start_expr`] nowhere near anyone's
/// midnight. Clamped, not rejected: every caller is a read path.
fn bounded(offset_minutes: i64) -> i64 {
    offset_minutes.clamp(
        SessionReport::UTC_OFFSET_MIN_MINUTES,
        SessionReport::UTC_OFFSET_MAX_MINUTES,
    )
}

/// The offset as a signed second count, parenthesised so it can be subtracted
/// without `- -900` lexing as a `--` line comment.
fn shift(offset_minutes: i64) -> String {
    format!("({})", bounded(offset_minutes) * 60)
}

/// The offset as a SQLite datetime modifier — `'-420 minutes'`.
fn modifier(offset_minutes: i64) -> String {
    format!("'{} minutes'", bounded(offset_minutes))
}

/// `YYYY-MM-DD` of the reader's day containing the unix-seconds column `col`.
pub(super) fn local_day(col: &str, offset_minutes: i64) -> String {
    format!("date({col} + {}, 'unixepoch')", shift(offset_minutes))
}

/// The reader's day as a unix day *number*, for the integer-diff consecutiveness
/// the streak is built on. Floors rather than truncates: SQLite's `/` rounds
/// toward zero, so pre-1970 instants would put two distinct days on one number.
pub(super) fn local_day_number(col: &str, offset_minutes: i64) -> String {
    let shifted = format!("({col} + {})", shift(offset_minutes));
    // `%`, not `FLOOR(x / 86400.0)`: bundled SQLite lacks `floor`; integers stay exact past 2^53.
    // Truncating division, corrected down by one whenever it rounded the wrong
    // way — which is exactly when the remainder is negative.
    format!("(({shifted} / 86400) - (CASE WHEN {shifted} % 86400 < 0 THEN 1 ELSE 0 END))")
}

/// The trailing-12-month `months(month)` CTE body, on the reader's calendar.
/// Shared by `compute::books_per_month` and `ratings::rating_monthly` so the two
/// trend charts cannot disagree about which month a completion or rating falls in.
pub(super) fn month_spine(offset_minutes: i64) -> String {
    // A datetime modifier, unlike this module's second-shifts: a spine steps in
    // months, which a second-count cannot express.
    let now_local = format!("datetime('now', {})", modifier(offset_minutes));
    format!(
        "months(month) AS (
             SELECT strftime('%Y-%m', {now_local}, 'start of month', '-11 months')
             UNION ALL
             SELECT strftime('%Y-%m', month || '-01', '+1 month')
             FROM months
             WHERE month < strftime('%Y-%m', {now_local})
         )"
    )
}

/// `YYYY-MM` of the reader's month containing the unix-seconds column `col`.
pub(super) fn local_month(col: &str, offset_minutes: i64) -> String {
    format!(
        "strftime('%Y-%m', {col} + {}, 'unixepoch')",
        shift(offset_minutes)
    )
}

/// Datetime modifiers that move a day back to the Monday of its week. The Week
/// window and the chart builder's Week bucket both use this, so the week a window
/// opens on is the week its buckets are keyed on.
// `weekday 0` advances to the coming Sunday (staying put on one), so backing up
// six days lands on that week's Monday.
pub(super) const TO_MONDAY: &str = "'weekday 0', '-6 days'";

/// The live clock, as the SQLite time-value the window builders read.
const NOW: &str = "'now'";

/// Unix seconds (UTC) of the instant a range's window opens, on the reader's
/// calendar. Every range is period-to-date: a Week opens on the reader's Monday,
/// so on a Monday it holds one day. Calendar arithmetic stays in SQLite; each arm
/// is a fixed literal built from a bounds-checked integer, never user input.
pub(super) fn window_start_expr(range: StatsRange, offset_minutes: i64) -> String {
    window_start_at(range, offset_minutes, NOW)
}

/// [`window_start_expr`] against an injected clock — `now` is any SQLite
/// time-value expression — so a test can pin the weekday it runs on.
fn window_start_at(range: StatsRange, offset_minutes: i64, now: &str) -> String {
    let (m, s) = (modifier(offset_minutes), shift(offset_minutes));
    // Snap on the reader's wall clock, then `- shift` back to the UTC instant: the
    // bound is compared against UTC `started_at` columns.
    let local = format!("datetime({now}, {m})");
    match range {
        StatsRange::Week => {
            format!("strftime('%s', {local}, 'start of day', {TO_MONDAY}) - {s}")
        }
        StatsRange::Month => format!("strftime('%s', {local}, 'start of month') - {s}"),
        StatsRange::Year => format!("strftime('%s', {local}, 'start of year') - {s}"),
        StatsRange::AllTime => "0".to_string(),
    }
}

/// Unix seconds (UTC) of the instant the *preceding* window opens, or `None` for
/// [`StatsRange::AllTime`]. Shares [`window_start_expr`]'s shape so the current
/// window and its baseline cannot drift onto different definitions of a period.
pub(super) fn prev_window_start_expr(range: StatsRange, offset_minutes: i64) -> Option<String> {
    prev_window_start_at(range, offset_minutes, NOW)
}

/// [`prev_window_start_expr`] against an injected clock, as
/// [`window_start_at`].
fn prev_window_start_at(range: StatsRange, offset_minutes: i64, now: &str) -> Option<String> {
    let (m, s) = (modifier(offset_minutes), shift(offset_minutes));
    let local = format!("datetime({now}, {m})");
    Some(match range {
        StatsRange::Week => {
            format!("strftime('%s', {local}, 'start of day', {TO_MONDAY}, '-7 days') - {s}")
        }
        // Month arithmetic runs on a month-start anchor: applying '-1 month' to
        // a month-end 'now' (e.g. July 31) normalizes to day 1 of the *current*
        // month and collapses the window.
        StatsRange::Month => {
            format!("strftime('%s', {local}, 'start of month', '-1 month') - {s}")
        }
        StatsRange::Year => format!("strftime('%s', {local}, 'start of year', '-1 year') - {s}"),
        StatsRange::AllTime => return None,
    })
}

/// Today on the reader's calendar as `(YYYY-MM-DD, unix day number)`.
///
/// Both from **one** expression pair evaluated in a single statement, so the
/// heatmap's right edge and the streak's anchor cannot straddle midnight and
/// describe different days.
pub(super) fn today_expr(offset_minutes: i64) -> String {
    let now = "CAST(strftime('%s','now') AS INTEGER)";
    format!(
        "SELECT {} AS day, {} AS dnum",
        local_day(now, offset_minutes),
        local_day_number(now, offset_minutes)
    )
}
