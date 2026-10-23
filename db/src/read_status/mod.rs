//! Per-user read/unread state CRUD — one row per `(user, book)`, last-write-wins,
//! soft-referencing `books.uuid` via the merged-uuid resolver (mirrors `ratings`,
//! so a pruned book detaches rather than deleting). `finished_at` is stamped when
//! a book becomes `finished` and cleared otherwise, so the stats "finished"
//! aggregations can window completions like the journal path windows `created_at`.
//! The one other writer is a position: `progress::upsert_progress_tx` creates a
//! `reading` row for a book that has none.

use omnibus_shared::{ReadStatus, ReadStatusRecord, SetReadStatus};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};

use crate::{resolve_canonical_book_uuid, resolve_canonical_book_uuid_exec};

/// Failure space for the read-status reads and writes.
#[derive(Debug, thiserror::Error)]
pub enum ReadStatusError {
    #[error("book not found")]
    BookNotFound,
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

impl From<crate::books::BooksError> for ReadStatusError {
    fn from(e: crate::books::BooksError) -> Self {
        match e {
            crate::books::BooksError::Db(inner) => Self::Sqlx(inner),
            // `resolve_canonical_book_uuid` is the only `BooksError`-returning
            // call this module makes and it never reads overrides, so neither
            // remaining variant is reachable here. Fold them into a decode
            // error rather than panicking, mirroring `ratings`/`progress`.
            crate::books::BooksError::OverridesJson(inner) => {
                Self::Sqlx(sqlx::Error::Decode(Box::new(inner)))
            }
            crate::books::BooksError::Other(msg) => Self::Sqlx(sqlx::Error::Decode(msg.into())),
        }
    }
}

/// Row → record, reading the persisted status token fail-open.
fn record_from_row(
    book_uuid: String,
    row: &sqlx::sqlite::SqliteRow,
) -> Result<ReadStatusRecord, sqlx::Error> {
    Ok(ReadStatusRecord {
        book_uuid,
        status: ReadStatus::from_db(row.try_get::<String, _>("status")?.as_str()),
        updated_at: row.try_get::<i64, _>("updated_at")?,
        finished_at: row.try_get::<Option<i64>, _>("finished_at")?,
        updated_at_iso: None,
    }
    .with_iso())
}

/// The row a write just left for `(user, book)`.
async fn read_back(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: i64,
    book_uuid: String,
) -> Result<ReadStatusRecord, ReadStatusError> {
    let row = sqlx::query(
        "SELECT status, updated_at, finished_at FROM book_read_status
         WHERE user_id = ? AND book_uuid = ?",
    )
    .bind(user_id)
    .bind(&book_uuid)
    .fetch_one(&mut **tx)
    .await?;
    Ok(record_from_row(book_uuid, &row)?)
}

/// Upsert the read state for `(user, book)` and return the new server-authoritative
/// record, keyed on the **canonical** `books.uuid` (`BookNotFound` if never indexed).
/// `finished_at` is set to now when transitioning into `finished`, preserved when
/// re-affirming it, and cleared to NULL for `unread` / `reading`.
pub async fn set_read_status(
    pool: &SqlitePool,
    user_id: i64,
    update: &SetReadStatus,
) -> Result<ReadStatusRecord, ReadStatusError> {
    // Same BEGIN IMMEDIATE reasoning as `progress::upsert_progress` (#1862).
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let record = set_read_status_tx(&mut tx, user_id, update).await?;
    tx.commit().await?;
    // A status moves the stats summary's finished list, so the cached one is stale.
    crate::stats::invalidate_user(user_id);
    Ok(record)
}

/// Transaction-scoped [`set_read_status`], for callers that batch it with
/// other writes (e.g. the Kobo `put_state` handler) inside one shared
/// `Transaction` so a mid-batch failure rolls back every entry, not just the
/// one that failed. The caller is responsible for committing or rolling back.
pub async fn set_read_status_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: i64,
    update: &SetReadStatus,
) -> Result<ReadStatusRecord, ReadStatusError> {
    let book_uuid = resolve_canonical_book_uuid_exec(&mut **tx, &update.book_uuid)
        .await?
        .ok_or(ReadStatusError::BookNotFound)?;
    let status = update.status.as_str();
    // `finished_at` binds `status` a second time so the CASE picks now-or-null
    // on insert; the ON CONFLICT arm COALESCEs against the existing value so a
    // re-affirmed `finished` keeps its original completion moment.
    sqlx::query(
        "INSERT INTO book_read_status (user_id, book_uuid, status, updated_at, finished_at)
         VALUES (?, ?, ?, strftime('%s','now'),
                 CASE WHEN ? = 'finished' THEN strftime('%s','now') ELSE NULL END)
         ON CONFLICT(user_id, book_uuid) DO UPDATE SET
             status = excluded.status,
             updated_at = strftime('%s','now'),
             auto_started = 0,
             finished_at = CASE
                 WHEN excluded.status = 'finished'
                     THEN COALESCE(book_read_status.finished_at, strftime('%s','now'))
                 ELSE NULL
             END",
    )
    .bind(user_id)
    .bind(&book_uuid)
    .bind(status)
    .bind(status)
    .execute(&mut **tx)
    .await?;

    read_back(tx, user_id, book_uuid).await
}

/// [`set_read_status_tx`], but newest-wins on `event_at` (unix seconds, clamped to now): the
/// write lands only if it is `>=` the stored `updated_at` (or the stored status is one a position
/// started, which no explicit status loses to), and stamps that time (and `finished_at` on a move
/// into finished). Returns the surviving record.
pub async fn set_read_status_at_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: i64,
    update: &SetReadStatus,
    event_at: i64,
) -> Result<ReadStatusRecord, ReadStatusError> {
    let book_uuid = resolve_canonical_book_uuid_exec(&mut **tx, &update.book_uuid)
        .await?
        .ok_or(ReadStatusError::BookNotFound)?;
    // The cast matters: `strftime` is TEXT, which SQLite ranks above every INTEGER, so a bare
    // `MIN(?, strftime(..))` would never clamp (see `progress::upsert`).
    sqlx::query(
        "INSERT INTO book_read_status (user_id, book_uuid, status, updated_at, finished_at)
         VALUES (?1, ?2, ?3, MIN(?4, CAST(strftime('%s','now') AS INTEGER)),
                 CASE WHEN ?3 = 'finished'
                      THEN MIN(?4, CAST(strftime('%s','now') AS INTEGER)) END)
         ON CONFLICT(user_id, book_uuid) DO UPDATE SET
             status = excluded.status,
             updated_at = excluded.updated_at,
             auto_started = 0,
             finished_at = CASE
                 WHEN excluded.status = 'finished'
                     THEN COALESCE(book_read_status.finished_at, excluded.updated_at)
                 ELSE NULL
             END
         WHERE excluded.updated_at >= book_read_status.updated_at
            OR book_read_status.auto_started = 1",
    )
    .bind(user_id)
    .bind(&book_uuid)
    .bind(update.status.as_str())
    .bind(event_at)
    .execute(&mut **tx)
    .await?;
    read_back(tx, user_id, book_uuid).await
}

/// Fetch the current read state for `(user, book_uuid)`. Returns `Ok(None)` for
/// an unknown book uuid or for a book the user has no row for yet — callers
/// treat the absence as [`ReadStatus::Unread`].
pub async fn get_read_status(
    pool: &SqlitePool,
    user_id: i64,
    book_uuid: &str,
) -> Result<Option<ReadStatusRecord>, ReadStatusError> {
    let Some(canonical) = resolve_canonical_book_uuid(pool, book_uuid).await? else {
        return Ok(None);
    };
    let Some(row) = sqlx::query(
        "SELECT status, updated_at, finished_at FROM book_read_status
         WHERE user_id = ? AND book_uuid = ?",
    )
    .bind(user_id)
    .bind(&canonical)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };
    Ok(Some(record_from_row(canonical, &row)?))
}

#[cfg(test)]
mod tests;
