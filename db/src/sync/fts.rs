//! The single door for maintaining the standalone `books_fts` index. It is a
//! standalone FTS5 vtable (no `content=`) with only rename triggers, so every
//! book mutation mirrors its row by hand through [`upsert_fts`] /
//! [`delete_fts`] rather than an open-coded DELETE/INSERT per write site. Both
//! take a `&mut SqliteConnection`, so they work in a transaction or on a pool.

use std::sync::OnceLock;

use anyhow::Context;
use sqlx::{SqliteConnection, SqlitePool};

/// Rows per chunk for [`upsert_fts_batch`]'s two `IN (...)` lists — one bind
/// per book id per list, comfortably under SQLite's ~999-parameter cap.
const UPSERT_BATCH_CHUNK: usize = 450;

/// The `SELECT` projection shared by the per-book upsert and the whole-table
/// rebuild: same columns, same correlated subqueries, built once so the call
/// sites can't drift apart (append `WHERE b.id = ?` for the single-book form).
/// `authors` / `series` / `tags` mirror the rename-trigger projections in
/// 0005_fts5.sql; `genres` has no canonical table, see [`GENRES_FROM_OVERRIDES`].
fn fts_select_from_books() -> &'static str {
    static SQL: OnceLock<String> = OnceLock::new();
    SQL.get_or_init(|| {
        format!(
            "
    SELECT
        b.id,
        COALESCE(b.title, ''),
        COALESCE((SELECT group_concat(a.name, ' ')
                  FROM books_authors_link l JOIN authors a ON a.id = l.author
                  WHERE l.book = b.id), ''),
        COALESCE((SELECT group_concat(s.name, ' ')
                  FROM books_series_link l JOIN series s ON s.id = l.series
                  WHERE l.book = b.id), ''),
        COALESCE((SELECT group_concat(t.name, ' ')
                  FROM books_tags_link l JOIN tags t ON t.id = l.tag
                  WHERE l.book = b.id), ''),
        COALESCE(b.description, ''),
        COALESCE((SELECT bi.value FROM book_identifiers bi
                  WHERE bi.book_id = b.id AND bi.scheme = 'ISBN' COLLATE NOCASE
                  LIMIT 1), ''),
        {GENRES_FROM_OVERRIDES}
     FROM books b"
        )
    })
}

/// The `genres` source expression for a book aliased `b`: the override JSON's
/// `$.genres`, space-joined. A corrupt overrides blob yields no genres instead of
/// failing the reindex, and the metadata-precedence gate keeps this door in step
/// with `overlay_overrides` (a no-op under the default precedence).
// `json_valid` guards the `json_each` argument, not a `WHERE` (which would rely on
// planner order). The gate mirrors `apply_overrides`'s `overrides_outrank_embedded`
// early return; a missing entry or malformed list falls back to true, as there.
const GENRES_FROM_OVERRIDES: &str = "
    CASE WHEN (SELECT COALESCE(
                 (SELECT o.key FROM json_each(CASE WHEN json_valid(sr.metadata_precedence)
                                                   THEN sr.metadata_precedence ELSE '[]' END) o
                   WHERE o.value = 'omnibus_overrides')
                 >
                 (SELECT e.key FROM json_each(CASE WHEN json_valid(sr.metadata_precedence)
                                                   THEN sr.metadata_precedence ELSE '[]' END) e
                   WHERE e.value = 'embedded_tags'), 1)
                FROM scan_roots sr WHERE sr.id = b.library_id)
         THEN COALESCE((SELECT group_concat(je.value, ' ')
                          FROM metadata_overrides mo
                          JOIN json_each(CASE WHEN json_valid(mo.overrides)
                                              THEN mo.overrides ELSE '{}' END, '$.genres') je
                         WHERE mo.book_uuid = b.uuid), '')
         ELSE '' END";

/// The `books_fts` column list every INSERT site names, in
/// [`fts_select_from_books`]'s projection order. One constant so a future
/// column can't be added to the projection and left out of one of the three
/// insert sites.
const FTS_INSERT_COLUMNS: &str = "rowid, title, authors, series, tags, description, isbn, genres";

/// Delete-then-insert the `books_fts` row for `book_id`, sourcing the indexed text
/// from the canonical `books` row plus its taxonomy links. The only place that
/// inserts a single `books_fts` row; one door serves ebooks and audiobooks (same
/// `books` table). A no-op INSERT when `book_id` has no `books` row.
pub(crate) async fn upsert_fts(
    conn: &mut SqliteConnection,
    book_id: i64,
) -> Result<(), sqlx::Error> {
    delete_fts(&mut *conn, book_id).await?;
    static UPSERT_SQL: OnceLock<String> = OnceLock::new();
    let sql = UPSERT_SQL.get_or_init(|| {
        let select = fts_select_from_books();
        format!(
            "INSERT INTO books_fts({FTS_INSERT_COLUMNS})
             {select}
             WHERE b.id = ?"
        )
    });
    sqlx::query(sql).bind(book_id).execute(&mut *conn).await?;
    Ok(())
}

/// The many-books counterpart of [`upsert_fts`]: delete-then-insert the
/// `books_fts` rows for every id in `book_ids`, two DML statements per chunk of
/// [`UPSERT_BATCH_CHUNK`] rather than 2N. For a caller that knows its whole
/// affected set up front (a merge/split undo replaying a snapshot); duplicate ids
/// are harmless.
pub(crate) async fn upsert_fts_batch(
    conn: &mut SqliteConnection,
    book_ids: &[i64],
) -> Result<(), sqlx::Error> {
    for chunk in book_ids.chunks(UPSERT_BATCH_CHUNK) {
        let placeholders = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");

        let del_sql = format!("DELETE FROM books_fts WHERE rowid IN ({placeholders})");
        let mut del_q = sqlx::query(&del_sql);
        for &id in chunk {
            del_q = del_q.bind(id);
        }
        del_q.execute(&mut *conn).await?;

        let select = fts_select_from_books();
        let ins_sql = format!(
            "INSERT INTO books_fts({FTS_INSERT_COLUMNS})
             {select}
             WHERE b.id IN ({placeholders})"
        );
        let mut ins_q = sqlx::query(&ins_sql);
        for &id in chunk {
            ins_q = ins_q.bind(id);
        }
        ins_q.execute(&mut *conn).await?;
    }
    Ok(())
}

/// Delete the `books_fts` row for `book_id`. Idempotent — a missing row
/// is a no-op. The only place that removes a `books_fts` row by id.
pub(crate) async fn delete_fts(
    conn: &mut SqliteConnection,
    book_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM books_fts WHERE rowid = ?")
        .bind(book_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Rebuild the entire `books_fts` index from `books`: drop every row, then
/// re-insert every row in one batched `INSERT ... SELECT`. Used by the admin
/// "rebuild search index" job to repair drift from a failed post-commit refresh.
/// Idempotent; two DML statements in a single transaction, so the index is never
/// observed empty mid-rebuild, and orphan rows are swept by the leading `DELETE`.
pub async fn rebuild_all_fts(pool: &SqlitePool) -> anyhow::Result<()> {
    let mut tx = pool
        .begin()
        .await
        .context("rebuild_all_fts: begin transaction")?;
    sqlx::query("DELETE FROM books_fts")
        .execute(&mut *tx)
        .await
        .context("rebuild_all_fts: clear books_fts")?;
    let select = fts_select_from_books();
    sqlx::query(&format!(
        "INSERT INTO books_fts({FTS_INSERT_COLUMNS})
         {select}"
    ))
    .execute(&mut *tx)
    .await
    .context("rebuild_all_fts: repopulate books_fts")?;
    tx.commit()
        .await
        .context("rebuild_all_fts: commit transaction")?;
    Ok(())
}

#[cfg(test)]
mod tests;
