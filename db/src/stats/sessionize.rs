//! Stitching of session checkpoint rows back into sittings. Every client
//! flushes a running segment on a timer, so one sitting lands as many rows;
//! [`stitched`] regroups them at query time so callers count sittings rather
//! than flush cadence. Read-side only, but [`IDLE_GAP_SECS`] also bounds a
//! sitting on the ledger's write path.

/// Idle seconds that end a sitting. Comfortably above every client's flush
/// interval (the longest is the iOS reader's 300s checkpoint), so only real
/// idleness splits. `pub(crate)` because the forward-progress ledger scopes its
/// accrual to the same sitting (`db::progress::ledger::observe_percent_tx`).
pub(crate) const IDLE_GAP_SECS: i64 = 900;

/// Shortest sitting that counts as a session: a glance is not a sitting, and the
/// writers' own 5s floor is far too low to filter one. This bounds the **count**
/// only; every second stays in the seconds totals, which "Time read" reports.
// The floor lives here, not at the writers, so it applies to already-recorded rows
// and stays one number rather than four that can drift apart.
pub(super) const MIN_SITTING_SECS: i64 = 60;

/// Wrap a session-row union in the gap-and-islands grouping, yielding one
/// `(book_uuid, started_at, ended_at, secs, min_audio, max_audio)` row per stitched
/// sitting. `inner` must select `book_uuid, started_at, ended_at, secs, is_audio` (0
/// reading, 1 listening) and carries its own binds. `min_audio < max_audio` marks a
/// sitting both tables fed. Sittings are scoped per book, so counts sum across books.
pub(super) fn stitched(inner: &str) -> String {
    // The break test compares against a running MAX of every earlier row's
    // `ended_at`, not LAG's immediately-preceding one: rows overlap when a
    // book is read and listened to at once, and the row before by
    // `started_at` can then end earlier than one before it, which LAG would
    // read as an idle gap and split a single sitting on.
    format!(
        "SELECT book_uuid, MIN(started_at) AS started_at, MAX(ended_at) AS ended_at,
                 SUM(secs) AS secs,
                 MIN(is_audio) AS min_audio, MAX(is_audio) AS max_audio FROM (
             SELECT book_uuid, started_at, ended_at, secs, is_audio,
                    SUM(brk) OVER (
                        PARTITION BY book_uuid ORDER BY started_at, ended_at
                        ROWS UNBOUNDED PRECEDING
                    ) AS sitting
             FROM (
                 SELECT book_uuid, started_at, ended_at, secs, is_audio,
                        CASE WHEN started_at - MAX(ended_at) OVER (
                                 PARTITION BY book_uuid ORDER BY started_at, ended_at
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                             ) > {IDLE_GAP_SECS} THEN 1 ELSE 0 END AS brk
                 FROM ({inner})
             )
         ) GROUP BY book_uuid, sitting"
    )
}
