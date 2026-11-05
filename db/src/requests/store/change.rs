//! The ways a reader moves a live request: cancelling it (and taking that back), and giving
//! up the version that is downloading. Each is one conditional write, so a double click or a
//! race with the download poller cannot apply it twice.

use sqlx::SqlitePool;

use super::{row_to_request, RequestError, RequestRow, COLUMNS, DOWNLOADING, LIVE_STATES, NOW};

/// How long after a cancel the download keeps going, so Undo can take it back.
pub const CANCEL_GRACE_SECS: i64 = 10;

/// Cancel request `id` for user `by` at `now`: it reads `cancelled` at once, and the
/// download is removed once [`CANCEL_GRACE_SECS`] pass. [`RequestError::WrongState`] unless the
/// request is still going: not stuck, cancelled or fully downloaded. One statement, so a
/// double click cancels once.
pub async fn cancel(pool: &SqlitePool, id: i64, by: i64, now: i64) -> Result<(), RequestError> {
    let moved = sqlx::query(&format!(
        "UPDATE book_requests
         SET prior_state = state, state = 'cancelled', cancelled_by = ?, cancel_at = ?,
             updated_at = {NOW}
         WHERE id = ? AND (state IN ('looking', 'choose', 'chosen') OR {DOWNLOADING})"
    ))
    .bind(by)
    .bind(now + CANCEL_GRACE_SECS)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if moved == 0 {
        return Err(RequestError::WrongState);
    }
    Ok(())
}

/// Take back a cancel while its grace lasts, returning the restored request. It fails with
/// [`RequestError::WrongState`] once the grace has ended (the poller claims the download at
/// that moment), for a request not cancelled, or when the reader has since started another
/// request for the same book and format; with [`RequestError::TooManyLive`] when they now hold
/// `max_live` requests.
pub async fn undo_cancel(
    pool: &SqlitePool,
    id: i64,
    now: i64,
    max_live: i64,
) -> Result<RequestRow, RequestError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let live: Option<(i64, i64)> = sqlx::query_as(&format!(
        "SELECT (SELECT COUNT(*) FROM book_requests o WHERE o.user_id = q.user_id
                                                         AND o.state IN {LIVE_STATES}),
                (SELECT COUNT(*) FROM book_requests o WHERE o.user_id = q.user_id
                                                         AND o.book_uuid = q.book_uuid
                                                         AND o.kind = q.kind
                                                         AND o.state IN {LIVE_STATES})
         FROM book_requests q
         WHERE q.id = ? AND q.state = 'cancelled' AND q.cancel_at > ? AND q.prior_state IS NOT NULL"
    ))
    .bind(id)
    .bind(now)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((all, same)) = live else {
        return Err(RequestError::WrongState);
    };
    if same > 0 {
        return Err(RequestError::WrongState);
    }
    if all >= max_live {
        return Err(RequestError::TooManyLive);
    }
    let row = sqlx::query(&format!(
        "UPDATE book_requests
         SET state = prior_state, prior_state = NULL, cancelled_by = NULL, cancel_at = NULL,
             updated_at = {NOW}
         WHERE id = ? AND state = 'cancelled' AND cancel_at > ?
         RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(now)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(row_to_request(&row)?)
}

/// Give up the picked version of a downloading or stopped request: it is never offered again
/// (the page shows it as one that did not work), and the request goes back to choosing among
/// the others, or to `looking` when none is left, which the caller then searches for. The
/// download moves to the removal list for the poller. `note` is recorded for the history.
/// [`RequestError::WrongState`] for a request not downloading or stopped, or whose earlier
/// download is still being taken out of the client.
pub async fn swap(
    pool: &SqlitePool,
    id: i64,
    now: i64,
    note: Option<&str>,
) -> Result<RequestRow, RequestError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let row = swap_in(&mut tx, id, now, note).await?;
    tx.commit().await?;
    Ok(row)
}

/// [`swap`] inside a write transaction the caller holds.
pub(super) async fn swap_in(
    tx: &mut sqlx::SqliteConnection,
    id: i64,
    now: i64,
    note: Option<&str>,
) -> Result<RequestRow, RequestError> {
    let picked: Option<Option<i64>> = sqlx::query_scalar(&format!(
        "SELECT chosen_result_id FROM book_requests
         WHERE id = ? AND remove_tag IS NULL
           AND ({DOWNLOADING} OR (state = 'stuck' AND stuck_reason = 'stopped_moving'))"
    ))
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(picked) = picked else {
        return Err(RequestError::WrongState);
    };
    sqlx::query("UPDATE book_request_results SET rejected = 1, tried = 1 WHERE id = ?")
        .bind(picked)
        .execute(&mut *tx)
        .await?;
    let row = sqlx::query(&format!(
        "UPDATE book_requests
         SET state = CASE WHEN EXISTS (SELECT 1 FROM book_request_results
                                       WHERE request_id = ?1 AND rejected = 0)
                          THEN 'choose' ELSE 'looking' END,
             remove_tag = client_tag,
             remove_since = CASE WHEN client_tag IS NULL THEN NULL ELSE ?2 END,
             client_tag = NULL, chosen_result_id = NULL, progress = NULL, moved_at = NULL,
             stuck_reason = NULL, stuck_detail = NULL, note = ?3, updated_at = {NOW}
         WHERE id = ?1 RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(now)
    .bind(note)
    .fetch_one(&mut *tx)
    .await?;
    Ok(row_to_request(&row)?)
}
