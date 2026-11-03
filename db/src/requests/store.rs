//! Rows of the book-request tables: a reader's request for one format of a book and the
//! versions its search found. The handlers and the search task both go through here, so
//! the state rules (one live request per reader, book and format; a version only chosen
//! while the request waits on the reader) hold in one place.

use omnibus_shared::{RequestKind, RequestState, RequestVersion, StuckReason};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

use super::rank::Ranked;

/// A request live for its reader: searching, waiting on a pick, picked or downloading.
const LIVE_STATES: &str = "('looking', 'choose', 'chosen', 'on_its_way')";

const NOW: &str = "strftime('%s', 'now')";

const COLUMNS: &str = "id, book_uuid, user_id, kind, state, stuck_reason, stuck_detail, \
                       chosen_result_id, client_tag, progress, moved_at, cancel_at, cancelled_by, \
                       prior_state, note, created_at, updated_at";

/// Why a request could not be recorded or changed.
#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    /// The reader already has as many live requests as allowed.
    #[error("too many requests in progress")]
    TooManyLive,
    /// The request is not in a state this change applies to.
    #[error("the request is not in the right state")]
    WrongState,
    /// The request has no such version to pick.
    #[error("no such version")]
    NotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// One request as stored. `stuck_detail` is for admins only; the handler withholds it.
#[derive(Debug, Clone, PartialEq)]
pub struct RequestRow {
    pub id: i64,
    pub book_uuid: String,
    pub user_id: i64,
    pub kind: RequestKind,
    pub state: RequestState,
    pub stuck_reason: Option<StuckReason>,
    pub stuck_detail: Option<String>,
    pub chosen_result_id: Option<i64>,
    /// The name of the download in the client; never sent to a reader.
    pub client_tag: Option<String>,
    /// How much of the download is done, 0 to 1.
    pub progress: Option<f64>,
    /// When the download last gained bytes, in Unix seconds.
    pub moved_at: Option<i64>,
    /// When the client is told to remove the download, in Unix seconds.
    pub cancel_at: Option<i64>,
    pub cancelled_by: Option<i64>,
    /// The state Undo restores while `cancel_at` is ahead.
    pub prior_state: Option<RequestState>,
    pub note: Option<String>,
    /// Unix seconds.
    pub created_at: i64,
    /// Unix seconds.
    pub updated_at: i64,
}

/// The outcome of [`start`].
#[derive(Debug, Clone, PartialEq)]
pub struct Started {
    pub request: RequestRow,
    /// False when the reader already had a live request and it is returned unchanged.
    pub created: bool,
}

/// What a search came to.
pub enum SearchOutcome {
    /// Every result, kept and dropped, in rank order.
    Found(Vec<Ranked>),
    Stuck {
        reason: StuckReason,
        detail: Option<String>,
    },
}

fn row_to_request(row: &SqliteRow) -> Result<RequestRow, sqlx::Error> {
    let corrupt = |column: &str, value: String| {
        sqlx::Error::Decode(format!("book_requests.{column} holds {value:?}").into())
    };
    let kind: String = row.try_get("kind")?;
    let state: String = row.try_get("state")?;
    let reason: Option<String> = row.try_get("stuck_reason")?;
    let prior: Option<String> = row.try_get("prior_state")?;
    Ok(RequestRow {
        id: row.try_get("id")?,
        book_uuid: row.try_get("book_uuid")?,
        user_id: row.try_get("user_id")?,
        kind: RequestKind::from_db(&kind).ok_or_else(|| corrupt("kind", kind))?,
        state: RequestState::from_db(&state).ok_or_else(|| corrupt("state", state))?,
        stuck_reason: reason
            .map(|r| StuckReason::from_db(&r).ok_or_else(|| corrupt("stuck_reason", r)))
            .transpose()?,
        stuck_detail: row.try_get("stuck_detail")?,
        chosen_result_id: row.try_get("chosen_result_id")?,
        client_tag: row.try_get("client_tag")?,
        progress: row.try_get("progress")?,
        moved_at: row.try_get("moved_at")?,
        cancel_at: row.try_get("cancel_at")?,
        cancelled_by: row.try_get("cancelled_by")?,
        prior_state: prior
            .map(|p| RequestState::from_db(&p).ok_or_else(|| corrupt("prior_state", p)))
            .transpose()?,
        note: row.try_get("note")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// Start `user_id`'s request for `kind` of `book_uuid`, or return the one they already have
/// live. Refuses a new request once they hold `max_live`. Find, count and insert run in one
/// write transaction, so a double click cannot create two rows.
pub async fn start(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
    kind: RequestKind,
    max_live: i64,
) -> Result<Started, RequestError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let existing = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests
         WHERE user_id = ? AND book_uuid = ? AND kind = ? AND state IN {LIVE_STATES}"
    ))
    .bind(user_id)
    .bind(book_uuid)
    .bind(kind.as_str())
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(row) = existing {
        return Ok(Started {
            request: row_to_request(&row)?,
            created: false,
        });
    }
    let live: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM book_requests WHERE user_id = ? AND state IN {LIVE_STATES}"
    ))
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    if live >= max_live {
        return Err(RequestError::TooManyLive);
    }
    let row = sqlx::query(&format!(
        "INSERT INTO book_requests (book_uuid, user_id, kind, state)
         VALUES (?, ?, ?, 'looking') RETURNING {COLUMNS}"
    ))
    .bind(book_uuid)
    .bind(user_id)
    .bind(kind.as_str())
    .fetch_one(&mut *tx)
    .await?;
    let request = row_to_request(&row)?;
    tx.commit().await?;
    Ok(Started {
        request,
        created: true,
    })
}

/// The request with this id, if any.
pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<RequestRow>, RequestError> {
    let row = sqlx::query(&format!("SELECT {COLUMNS} FROM book_requests WHERE id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.as_ref().map(row_to_request).transpose()?)
}

/// Every request for the book, newest first.
pub async fn list_for_book(
    pool: &SqlitePool,
    book_uuid: &str,
) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests WHERE book_uuid = ? ORDER BY id DESC"
    ))
    .bind(book_uuid)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(row_to_request)
        .collect::<Result<Vec<_>, sqlx::Error>>()?)
}

/// The versions worth showing for a request, best first. Rejected ones are kept in the
/// table but never returned.
pub async fn versions(
    pool: &SqlitePool,
    request_id: i64,
) -> Result<Vec<RequestVersion>, RequestError> {
    let rows = sqlx::query(
        "SELECT id, title, size_bytes, format, indexer, best_match FROM book_request_results
         WHERE request_id = ? AND rejected = 0 ORDER BY score DESC, id",
    )
    .bind(request_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|r| {
            Ok(RequestVersion {
                id: r.try_get("id")?,
                title: r.try_get("title")?,
                size_bytes: r.try_get("size_bytes")?,
                format: r.try_get("format")?,
                indexer: r.try_get("indexer")?,
                best_match: r.try_get::<i64, _>("best_match")? != 0,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?)
}

/// Record how a search ended, but only for a request still `looking`: one that was
/// restarted, picked or answered meanwhile keeps its state.
pub async fn finish_search(
    pool: &SqlitePool,
    id: i64,
    outcome: SearchOutcome,
) -> Result<(), RequestError> {
    let (state, reason, detail) = match &outcome {
        SearchOutcome::Found(_) => (RequestState::Choose, None, None),
        SearchOutcome::Stuck { reason, detail } => (
            RequestState::Stuck,
            Some(reason.as_str()),
            detail.as_deref(),
        ),
    };
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let moved = sqlx::query(&format!(
        "UPDATE book_requests SET state = ?, stuck_reason = ?, stuck_detail = ?, updated_at = {NOW}
         WHERE id = ? AND state = 'looking'"
    ))
    .bind(state.as_str())
    .bind(reason)
    .bind(detail)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if moved == 0 {
        return Ok(());
    }
    if let SearchOutcome::Found(ranked) = &outcome {
        sqlx::query("DELETE FROM book_request_results WHERE request_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        for r in ranked {
            insert_result(&mut tx, id, r).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

async fn insert_result(
    tx: &mut sqlx::SqliteConnection,
    request_id: i64,
    ranked: &Ranked,
) -> Result<(), sqlx::Error> {
    let r = &ranked.release;
    sqlx::query(
        "INSERT INTO book_request_results
         (request_id, guid, title, size_bytes, format, seeders, indexer, download_url, score, best_match, rejected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(request_id)
    .bind(&r.guid)
    .bind(&r.title)
    .bind(r.size_bytes)
    .bind(&ranked.format)
    .bind(r.seeders)
    .bind(&r.indexer)
    .bind(&r.link)
    .bind(ranked.score)
    .bind(ranked.best_match)
    .bind(ranked.rejected)
    .execute(tx)
    .await?;
    Ok(())
}

/// Send a `looking` or `stuck` request back to `looking` and forget what it found.
/// [`RequestError::WrongState`] for one already waiting on a pick or picked.
pub async fn restart(pool: &SqlitePool, id: i64) -> Result<(), RequestError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let moved = sqlx::query(&format!(
        "UPDATE book_requests
         SET state = 'looking', stuck_reason = NULL, stuck_detail = NULL, updated_at = {NOW}
         WHERE id = ? AND state IN ('looking', 'stuck')"
    ))
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if moved == 0 {
        return Err(RequestError::WrongState);
    }
    sqlx::query("DELETE FROM book_request_results WHERE request_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Pick `result_id` for request `id`. The version must be a kept one of this request, and the
/// request must be waiting on a pick ([`RequestError::WrongState`] otherwise;
/// [`RequestError::NotFound`] when the version is not this request's or was dropped). The
/// checks and the change are one statement, so a double click picks once.
pub async fn choose(pool: &SqlitePool, id: i64, result_id: i64) -> Result<(), RequestError> {
    let moved = sqlx::query(&format!(
        "UPDATE book_requests SET state = 'chosen', chosen_result_id = ?1, updated_at = {NOW}
         WHERE id = ?2 AND state = 'choose'
           AND EXISTS (SELECT 1 FROM book_request_results
                       WHERE id = ?1 AND request_id = ?2 AND rejected = 0)"
    ))
    .bind(result_id)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if moved == 1 {
        return Ok(());
    }
    match get(pool, id).await? {
        Some(r) if r.state != RequestState::Choose => Err(RequestError::WrongState),
        _ => Err(RequestError::NotFound),
    }
}

/// How long after a cancel the download keeps going, so Undo can take it back.
pub const CANCEL_GRACE_SECS: i64 = 8;

/// Cancel request `id` for user `by` at `now`: it reads `cancelled` at once, and the
/// download is removed once [`CANCEL_GRACE_SECS`] pass. [`RequestError::WrongState`] unless the
/// request is still going: not stuck, cancelled, fully downloaded, or waiting on the
/// removal of an earlier download. One statement, so a double click cancels once.
pub async fn cancel(pool: &SqlitePool, id: i64, by: i64, now: i64) -> Result<(), RequestError> {
    let moved = sqlx::query(&format!(
        "UPDATE book_requests
         SET prior_state = state, state = 'cancelled', cancelled_by = ?, cancel_at = ?,
             updated_at = {NOW}
         WHERE id = ? AND cancel_at IS NULL
           AND (state IN ('looking', 'choose', 'chosen')
                OR (state = 'on_its_way' AND (progress IS NULL OR progress < 1)))"
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

/// Take back a cancel while its grace lasts, returning the restored request.
/// [`RequestError::WrongState`] once the grace has ended or for a request not cancelled.
pub async fn undo_cancel(pool: &SqlitePool, id: i64, now: i64) -> Result<RequestRow, RequestError> {
    let row = sqlx::query(&format!(
        "UPDATE book_requests
         SET state = prior_state, prior_state = NULL, cancelled_by = NULL, cancel_at = NULL,
             updated_at = {NOW}
         WHERE id = ? AND state = 'cancelled' AND cancel_at > ? AND prior_state IS NOT NULL
         RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(now)
    .fetch_optional(pool)
    .await?;
    match row {
        Some(row) => Ok(row_to_request(&row)?),
        None => Err(RequestError::WrongState),
    }
}

/// The tag a request's download carries in the client, so a restart finds it again.
fn client_tag(id: i64) -> String {
    format!("omnibus-{id}")
}

/// The Unix time now, as the state changes below take it.
pub fn unix_now() -> i64 {
    crate::auth::now_unix()
}

/// Requests whose download the client is to remove: their `cancel_at` has come.
pub async fn due_removals(pool: &SqlitePool, now: i64) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests WHERE cancel_at IS NOT NULL AND cancel_at <= ? ORDER BY id"
    ))
    .bind(now)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_request).collect::<Result<_, _>>()?)
}

/// Forget a removal that has been carried out: the client no longer has the download.
pub async fn finish_removal(pool: &SqlitePool, id: i64, now: i64) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests SET client_tag = NULL, cancel_at = NULL
         WHERE id = ? AND cancel_at <= ?",
    )
    .bind(id)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Picked requests no download has been started for.
pub async fn awaiting_add(pool: &SqlitePool) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests
         WHERE state = 'chosen' AND cancel_at IS NULL AND chosen_result_id IS NOT NULL ORDER BY id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_request).collect::<Result<_, _>>()?)
}

/// Mark request `id`'s download with its tag, then return `(tag, link)` for the client. The tag
/// is written before the client is called, so a cancel that lands meanwhile still finds the
/// download to remove. `None` once the request is no longer waiting to be added. The link can
/// carry an indexer key: hand it to the client and nowhere else.
pub async fn begin_download(
    pool: &SqlitePool,
    id: i64,
) -> Result<Option<(String, String)>, RequestError> {
    let tag = client_tag(id);
    let moved = sqlx::query(
        "UPDATE book_requests SET client_tag = ?
         WHERE id = ? AND state = 'chosen' AND cancel_at IS NULL",
    )
    .bind(&tag)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if moved == 0 {
        return Ok(None);
    }
    let link: Option<String> = sqlx::query_scalar(
        "SELECT r.download_url FROM book_request_results r
         JOIN book_requests q ON q.chosen_result_id = r.id WHERE q.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(link.map(|link| (tag, link)))
}

/// Move a picked request to `on_its_way` once its download is with the client.
pub async fn mark_on_its_way(pool: &SqlitePool, id: i64, now: i64) -> Result<(), RequestError> {
    sqlx::query(&format!(
        "UPDATE book_requests SET state = 'on_its_way', moved_at = ?, updated_at = {NOW}
         WHERE id = ? AND state = 'chosen' AND cancel_at IS NULL"
    ))
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Requests on their way whose download has not finished.
pub async fn downloading(pool: &SqlitePool) -> Result<Vec<RequestRow>, RequestError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM book_requests
         WHERE state = 'on_its_way' AND client_tag IS NOT NULL AND (progress IS NULL OR progress < 1)
         ORDER BY id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_request).collect::<Result<_, _>>()?)
}

/// Record how far request `id`'s download is, and when it last gained bytes.
pub async fn record_progress(
    pool: &SqlitePool,
    id: i64,
    progress: f64,
    moved_at: i64,
) -> Result<(), RequestError> {
    sqlx::query(
        "UPDATE book_requests SET progress = ?, moved_at = ? WHERE id = ? AND state = 'on_its_way'",
    )
    .bind(progress)
    .bind(moved_at)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// End a picked or downloading request as `stopped_moving`. `detail` is for admins.
pub async fn mark_stopped(pool: &SqlitePool, id: i64, detail: &str) -> Result<(), RequestError> {
    sqlx::query(&format!(
        "UPDATE book_requests
         SET state = 'stuck', stuck_reason = 'stopped_moving', stuck_detail = ?, updated_at = {NOW}
         WHERE id = ? AND state IN ('chosen', 'on_its_way')"
    ))
    .bind(detail)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Whether the poller has anything to watch: a pick to add, a download to follow or a
/// removal to carry out.
pub async fn has_download_work(pool: &SqlitePool) -> Result<bool, RequestError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM book_requests
         WHERE state = 'chosen' OR cancel_at IS NOT NULL
            OR (state = 'on_its_way' AND (progress IS NULL OR progress < 1)))",
    )
    .fetch_one(pool)
    .await?)
}

#[cfg(test)]
mod tests;
