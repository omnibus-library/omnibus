//! Promote a fileless check-in/wishlist book off the synthetic Physical
//! pseudo-root once real library files reference it. Called by the sync
//! attach writers and the merge transaction the moment a file lands, and
//! by `init_db` as a boot backfill for rows stranded before the guard
//! existed.

use sqlx::{SqliteConnection, SqlitePool};

use super::{PhysicalError, PHYSICAL_LIBRARY_PATH};

/// The promotion UPDATE. A book under the Physical pseudo-root (`?1`) with a
/// `book_files` row in a *real* scan root moves to that root (lowest
/// `(ordinal, id)` file wins, like `book_file_path`). Books under a real root
/// and genuinely fileless books are untouched. Only `library_id` moves.
fn promote_sql(single_book: bool) -> String {
    let id_filter = if single_book {
        " AND books.id = ?2"
    } else {
        ""
    };
    // `books.path`/`scan_key` stay empty: the file is tracked through its
    // `merged_uuids` row, and stamping `scan_key` would surface it a second
    // time via `list_indexed_rows_for_formats`.
    format!(
        "UPDATE books
            SET library_id = (
                 SELECT sr.id
                   FROM book_files bf
                   JOIN scan_roots sr ON sr.path = bf.library_path AND sr.path <> ?1
                  WHERE bf.book_id = books.id
                  ORDER BY bf.ordinal, bf.id
                  LIMIT 1)
          WHERE books.library_id IN (SELECT id FROM scan_roots WHERE path = ?1)
            AND EXISTS (
                 SELECT 1
                   FROM book_files bf
                   JOIN scan_roots sr ON sr.path = bf.library_path AND sr.path <> ?1
                  WHERE bf.book_id = books.id){id_filter}"
    )
}

/// Promote one book off the Physical pseudo-root if a real file now backs it,
/// returning whether the row moved. The pseudo-root is never a configured
/// library path, so a filed book left there is visible only through a physical
/// copy. A cheap no-op otherwise, so attach/merge writers call it always.
pub(crate) async fn promote_filed_physical_book(
    conn: &mut SqliteConnection,
    book_id: i64,
) -> Result<bool, PhysicalError> {
    let result = sqlx::query(&promote_sql(true))
        .bind(PHYSICAL_LIBRARY_PATH)
        .bind(book_id)
        .execute(conn)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Boot backfill: promote every stranded Physical-root book that already
/// has real files — rows written before the attach-time guard existed.
/// Idempotent; a no-op once caught up.
pub(crate) async fn promote_filed_physical_books(pool: &SqlitePool) -> Result<u64, PhysicalError> {
    let promoted = sqlx::query(&promote_sql(false))
        .bind(PHYSICAL_LIBRARY_PATH)
        .execute(pool)
        .await?
        .rows_affected();
    if promoted > 0 {
        tracing::info!(
            promoted,
            "boot backfill: promoted filed books off the Physical pseudo-root"
        );
    }
    Ok(promoted)
}
