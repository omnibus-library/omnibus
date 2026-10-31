//! The series a reader is partway through, for their home page: the list
//! ([`in_progress`]) and the per-reader hide that keeps a series off it, set and
//! cleared from the series page and its row. Called by the `/api/series`
//! handlers. A hide names the series, never a book, so a merge or reindex has
//! nothing to settle.

use std::collections::{HashMap, HashSet};

use omnibus_shared::{BookReading, EbookMetadata, ReadStatus, SeriesInProgress};
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::metadata_overrides::sql::{
    effective_series_sql, override_present_sql, overrides_win_sql,
};
use crate::{book_reading, book_uuids, get_series, list_series, series_reading};
use crate::{BrowseError, DiscoveryError};

/// Failure space for the series-in-progress reads and writes.
#[derive(Debug, thiserror::Error)]
pub enum SeriesProgressError {
    #[error("series not found")]
    SeriesNotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Browse(#[from] BrowseError),
    #[error(transparent)]
    Discovery(#[from] DiscoveryError),
}

/// Hide `series_id` from the reader's home page; hiding it again is a no-op.
pub async fn hide(
    pool: &SqlitePool,
    user_id: i64,
    series_id: i64,
) -> Result<(), SeriesProgressError> {
    // One statement, so a series deleted mid-call can't be hidden after the check.
    let landed = sqlx::query(
        "INSERT INTO series_hides (user_id, series_id)
         SELECT ?, id FROM series WHERE id = ?
         ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .bind(series_id)
    .execute(pool)
    .await?
    .rows_affected();
    if landed == 0 {
        require_series(pool, series_id).await?;
    }
    Ok(())
}

/// Bring `series_id` back to the reader's home page; unhiding a shown series is a no-op.
pub async fn unhide(
    pool: &SqlitePool,
    user_id: i64,
    series_id: i64,
) -> Result<(), SeriesProgressError> {
    let removed = sqlx::query("DELETE FROM series_hides WHERE user_id = ? AND series_id = ?")
        .bind(user_id)
        .bind(series_id)
        .execute(pool)
        .await?
        .rows_affected();
    if removed == 0 {
        require_series(pool, series_id).await?;
    }
    Ok(())
}

/// Whether the reader hid `series_id` from their home page.
pub async fn is_hidden(
    pool: &SqlitePool,
    user_id: i64,
    series_id: i64,
) -> Result<bool, SeriesProgressError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM series_hides WHERE user_id = ? AND series_id = ?)",
    )
    .bind(user_id)
    .bind(series_id)
    .fetch_one(pool)
    .await?)
}

/// The series you are partway through: at least two books in the library, at least one you
/// are reading or have finished, and not all finished, minus the ones you hid. Latest read
/// first, then by name; each row is the series page's own read, so the two agree.
pub async fn in_progress(
    pool: &SqlitePool,
    user_id: i64,
    library_paths: &[&str],
) -> Result<Vec<SeriesInProgress>, SeriesProgressError> {
    let sizes: HashMap<i64, usize> = list_series(pool, library_paths)
        .await?
        .into_iter()
        .map(|s| (s.id, s.book_count))
        .collect();
    let hidden = hidden_series_ids(pool, user_id).await?;
    let mut rows = Vec::new();
    // shortcut: one series read per candidate, after counts drop the single-book and
    // finished series; revisit if readers hold hundreds of series partway.
    for counts in series_reading(pool, user_id, library_paths).await? {
        let size = sizes.get(&counts.series_id).copied().unwrap_or(0);
        let started = counts.finished + counts.reading > 0;
        if hidden.contains(&counts.series_id) || size < 2 || !started || counts.finished >= size {
            continue;
        }
        let Some(series) = get_series(pool, counts.series_id).await? else {
            continue;
        };
        let reading = book_reading(pool, user_id, &book_uuids(&series.books)).await?;
        rows.extend(row_if_in_progress(series, reading));
    }
    rows.sort_by(|a, b| {
        b.last_read_at
            .cmp(&a.last_read_at)
            .then_with(|| a.series.name.cmp(&b.series.name))
    });
    Ok(rows)
}

/// `series` as a list row, or `None` when the loaded books say it isn't in progress.
fn row_if_in_progress(
    mut series: omnibus_shared::SeriesDetail,
    reading: Vec<BookReading>,
) -> Option<SeriesInProgress> {
    let count = |status| reading.iter().filter(|r| r.status == status).count();
    let started = count(ReadStatus::Reading) + count(ReadStatus::Finished) > 0;
    let all_finished = count(ReadStatus::Finished) >= series.books.len();
    if series.books.len() < 2 || !started || all_finished {
        return None;
    }
    let next_book_uuid = next_book(&series.books, &reading)?
        .unique_identifier
        .clone()?;
    let last_read_at = reading.iter().filter_map(|r| r.last_read_at).max();
    series.reading = reading;
    Some(SeriesInProgress {
        series,
        next_book_uuid,
        last_read_at,
    })
}

/// The book to open next: the one being read that was read last (the later book on a tie),
/// else the first unread one in `books`' order. `None` when every book is finished.
pub fn next_book<'a>(
    books: &'a [EbookMetadata],
    reading: &[BookReading],
) -> Option<&'a EbookMetadata> {
    let state_of = |book: &EbookMetadata| {
        reading
            .iter()
            .find(|r| Some(&r.book_uuid) == book.unique_identifier.as_ref())
    };
    let being_read = books
        .iter()
        .filter_map(|b| {
            state_of(b)
                .filter(|r| r.status == ReadStatus::Reading)
                .map(|r| (b, r))
        })
        // `max_by_key` keeps the last of equal keys, so the later book wins a tie.
        .max_by_key(|(_, r)| r.last_read_at);
    being_read.map(|(book, _)| book).or_else(|| {
        books
            .iter()
            .find(|b| state_of(b).is_none_or(|r| r.status == ReadStatus::Unread))
    })
}

/// Lift the reader's hide on every series `book_uuid` is in, by effective membership. Runs in
/// the caller's transaction, so a failed start takes it back with the rest.
pub(crate) async fn unhide_series_of_book_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: i64,
    book_uuid: &str,
) -> Result<(), sqlx::Error> {
    let sql = format!(
        "DELETE FROM series_hides
          WHERE user_id = ?1
            AND series_id IN (SELECT e.series_id
                                FROM ({}) e
                                JOIN books b ON b.id = e.book_id
                               WHERE b.uuid = ?2)",
        effective_series_sql!()
    );
    sqlx::query(&sql)
        .bind(user_id)
        .bind(book_uuid)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn hidden_series_ids(
    pool: &SqlitePool,
    user_id: i64,
) -> Result<HashSet<i64>, SeriesProgressError> {
    let ids: Vec<i64> = sqlx::query_scalar("SELECT series_id FROM series_hides WHERE user_id = ?")
        .bind(user_id)
        .fetch_all(pool)
        .await?;
    Ok(ids.into_iter().collect())
}

/// A zero-row write is "already so" for a real series and an error for an unknown one.
async fn require_series(pool: &SqlitePool, series_id: i64) -> Result<(), SeriesProgressError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM series WHERE id = ?)")
        .bind(series_id)
        .fetch_one(pool)
        .await?;
    exists
        .then_some(())
        .ok_or(SeriesProgressError::SeriesNotFound)
}

#[cfg(test)]
mod tests;
