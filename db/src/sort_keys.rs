//! Denormalized sort-key columns carried on `books` for the keyset landing
//! path — today just `series_sort`, computed at index time by the sync writers
//! via [`series_sort_value`] and backfilled once at boot by
//! [`backfill_series_sort`]. Like `normalize`, this denormalizes **scanned**
//! metadata only; `metadata_overrides` is a read layer and is ignored here.

use omnibus_shared::EbookMetadata;
use sqlx::{SqliteConnection, SqlitePool};

use crate::normalize::creator_sort_key;

/// Errors returned by [`backfill_series_sort`].
#[derive(Debug, thiserror::Error)]
pub enum SortKeysError {
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// The `series_sort` value to store for a book: its primary series name
/// (trimmed, `#N` / ", Book N" index stripped), or `None` when it has no
/// non-empty series. Delegates to [`crate::helpers::cleaned_series_name`] so
/// this column and the `books_series_link` write always agree.
pub fn series_sort_value(m: &EbookMetadata) -> Option<String> {
    crate::helpers::cleaned_series_name(m)
}

/// Re-key `books.author_sort` from each book's lowest-position linked author,
/// the one the book displays first. Runs on the caller's connection so it joins
/// the transaction that changed the links; a book left with no links keeps its
/// stored value, since nothing remains to derive it from.
pub(crate) async fn refresh_author_sort(
    conn: &mut SqliteConnection,
    book_ids: &[i64],
) -> Result<(), sqlx::Error> {
    for book_id in book_ids {
        let first: Option<(Option<String>, String)> = sqlx::query_as(
            "SELECT a.sort, a.name FROM books_authors_link l
               JOIN authors a ON a.id = l.author
              WHERE l.book = ? ORDER BY l.position LIMIT 1",
        )
        .bind(book_id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some((sort, name)) = first else { continue };
        sqlx::query("UPDATE books SET author_sort = ? WHERE id = ?")
            .bind(creator_sort_key(sort.as_deref(), &name))
            .bind(book_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// One-time backfill of `books.series_sort`, run on every boot from `init_db`
/// (idempotent and cheap once caught up). Only selects rows whose `series_sort`
/// is NULL **and** that have a series link, so a seriesless book is never
/// re-touched. The value is the alphabetically first series name, matching
/// `BOOK_COLUMNS`' `series_json`.
pub async fn backfill_series_sort(pool: &SqlitePool) -> Result<(), SortKeysError> {
    // TRIM mirrors the write-time `series_sort_value` so backfilled rows match
    // freshly-indexed ones. The guard requires a non-whitespace linked series
    // name, so a (degenerate) whitespace-only series never traps a row in a
    // re-touch loop — it stays NULL and is skipped next boot.
    sqlx::query(
        r"
        UPDATE books
           SET series_sort = (
               SELECT TRIM(s.name)
                 FROM books_series_link bsl
                 JOIN series s ON s.id = bsl.series
                WHERE bsl.book = books.id
                ORDER BY s.name
                LIMIT 1
           )
         WHERE series_sort IS NULL
           AND EXISTS (
               SELECT 1
                 FROM books_series_link bsl
                 JOIN series s ON s.id = bsl.series
                WHERE bsl.book = books.id
                  AND TRIM(s.name) <> ''
           )
        ",
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests;
