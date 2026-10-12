//! Removed bucket: every uuid whose file disappeared keeps its `books` row. One
//! chunked DELETE drops only the book's own native `book_files` rows — a row
//! still backed by a `merged_uuids` entry is a cross-format attachment and
//! survives — then two chunked UPDATEs flag each book missing and clear its
//! `has_cover`, keeping the flag consistent with the cover file the
//! post-commit reconcile unlinks. Idempotent: a re-run on an already-fileless
//! row deletes nothing and both UPDATEs no-op via their guards.

use sqlx::Transaction;

/// `"?, ?, …"` for an `IN (…)` list of `n` binds. Every statement in this
/// module is chunked over a slice of ids, so they all need one.
fn placeholders(n: usize) -> String {
    std::iter::repeat_n("?", n).collect::<Vec<_>>().join(", ")
}

/// Mark a batch of removed books' files missing. The `books` row (metadata,
/// taxonomy links, FTS, soft-ref user data) is **retained**; only the book's own
/// native `book_files` rows are dropped (parts and chapters cascading), sparing
/// cross-format attachments in `merged_uuids`. The book stays in browse/search
/// and a returning file re-attaches via Changed. Idempotent on re-run.
pub(super) async fn sync_removed(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    library_id: i64,
    removed_uuids: &[String],
) -> Result<(), sqlx::Error> {
    if removed_uuids.is_empty() {
        return Ok(());
    }
    let mut missing = 0usize;
    // library_id + 1 bind per uuid; chunk at 500 to stay under SQLite's
    // 999-param cap when a whole library (or any large diff) is removed.
    for chunk in removed_uuids.chunks(500) {
        // Resolve the affected ids, then batch-drop their file rows and flag
        // the rows missing — keeping each `books` row (and its links/FTS) as a
        // fileless book. Two chunked statements replace the old per-book
        // `mark_book_files_missing` fan-out (which fired 2 DML per removed
        // book).
        let ids = resolve_removed_book_ids(tx, library_id, chunk).await?;
        missing += ids.len();
        if ids.is_empty() {
            continue;
        }
        delete_removed_book_files(tx, &ids).await?;
        flag_books_missing(tx, &ids).await?;
        clear_has_cover(tx, &ids).await?;
    }
    if missing > 0 {
        // These rows are flagged missing (F10); `missing_files::gc_books_missing_files`
        // purges the long-missing, user-data-free ones on a later reindex.
        tracing::info!(missing, "sync: retained removed books as fileless books");
    }
    Ok(())
}

/// Resolve one chunk's removed uuids to their `books.id`s within the library.
async fn resolve_removed_book_ids(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    library_id: i64,
    chunk: &[String],
) -> Result<Vec<i64>, sqlx::Error> {
    let uuid_placeholders = placeholders(chunk.len());
    let id_sql =
        format!("SELECT id FROM books WHERE library_id = ? AND uuid IN ({uuid_placeholders})");
    let mut q = sqlx::query_scalar::<_, i64>(&id_sql).bind(library_id);
    for uuid in chunk {
        q = q.bind(uuid);
    }
    q.fetch_all(&mut **tx).await
}

/// One DELETE per chunk: `book_file_parts` + `file_chapters` cascade off the
/// `book_files` row. Scoped to rows with **no** matching `merged_uuids` entry: a
/// recorded row is a cross-format attachment (a different format's file, still
/// present) and must survive this book's own file going missing, or it would just
/// re-attach on the next scan.
async fn delete_removed_book_files(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    ids: &[i64],
) -> Result<(), sqlx::Error> {
    let id_placeholders = placeholders(ids.len());
    let delete_sql = format!(
        "DELETE FROM book_files
          WHERE book_id IN ({id_placeholders})
            AND NOT EXISTS (
              SELECT 1 FROM merged_uuids mu
               WHERE mu.book_id = book_files.book_id
                 AND mu.format = book_files.format
                 AND mu.scan_key = book_files.scan_key
            )"
    );
    let mut delete_q = sqlx::query(&delete_sql);
    for id in ids {
        delete_q = delete_q.bind(id);
    }
    delete_q.execute(&mut **tx).await?;
    Ok(())
}

/// One UPDATE per chunk: clear `has_cover` for the books whose cover files the
/// post-commit reconcile is about to unlink (`delete_cover_files_for`). A
/// lingering flag strands the book with `has_cover = 1` and no file, which nothing
/// repairs; clearing it hands the book to `backfill_covers`. The uploaded override
/// (`metadata_overrides.has_cover_override`) is untouched.
async fn clear_has_cover(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    ids: &[i64],
) -> Result<(), sqlx::Error> {
    let id_placeholders = placeholders(ids.len());
    let update_sql =
        format!("UPDATE books SET has_cover = 0 WHERE id IN ({id_placeholders}) AND has_cover = 1");
    let mut update_q = sqlx::query(&update_sql);
    for id in ids {
        update_q = update_q.bind(id);
    }
    update_q.execute(&mut **tx).await?;
    Ok(())
}

/// One UPDATE per chunk: set the missing-files flag + start the retention clock.
/// `is_missing_files = 0` preserves the original `missing_files_since` on a re-run;
/// `is_missing_files_override = 0` leaves intentionally-fileless rows (wishlist)
/// unflagged; `NOT EXISTS book_files` skips a book whose cross-format attachment
/// survived the delete, since it isn't actually fileless.
async fn flag_books_missing(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    ids: &[i64],
) -> Result<(), sqlx::Error> {
    let id_placeholders = placeholders(ids.len());
    let update_sql = format!(
        "UPDATE books
            SET is_missing_files = 1, missing_files_since = unixepoch()
          WHERE id IN ({id_placeholders})
            AND is_missing_files = 0
            AND is_missing_files_override = 0
            AND NOT EXISTS (SELECT 1 FROM book_files WHERE book_files.book_id = books.id)"
    );
    let mut update_q = sqlx::query(&update_sql);
    for id in ids {
        update_q = update_q.bind(id);
    }
    update_q.execute(&mut **tx).await?;
    Ok(())
}
