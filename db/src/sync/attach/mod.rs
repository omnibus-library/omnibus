//! Cross-format auto-attach lookups shared by `sync_books` and
//! `sync_audiobooks`: before INSERTing a new `books` row, decide
//! whether the file actually belongs to an existing book in another
//! format (same work scanned as EPUB + M4B) and record the attachment
//! in `merged_uuids` so the next reindex won't resurrect a duplicate.

use sqlx::Transaction;

/// Reindex protection: has the file at `(library_path, scan_key)` already been
/// merged into / attached to a book (auto-attach or manual merge, even if titles
/// no longer match)? Returns the recorded `(uuid, book_id, format)` so the caller
/// re-attaches against the **stored** ledger uuid, not a recomputed one. Keyed on
/// the relative `scan_key`, so an attachment survives a scan-root repoint.
pub(super) async fn find_attachment_by_scan_key(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    library_path: &str,
    scan_key: &str,
) -> Result<Option<(String, i64, String)>, sqlx::Error> {
    sqlx::query_as::<_, (String, i64, String)>(
        "SELECT uuid, book_id, format FROM merged_uuids
          WHERE library_path = ? AND scan_key = ?",
    )
    .bind(library_path)
    .bind(scan_key)
    .fetch_optional(&mut **tx)
    .await
}

/// The attachment `uuid` names under `library_path`, as
/// `(book_id, scan_key)`. The move detector's uuids come from both diff
/// projections; this is the lookup for the `merged_uuids`-backed half, and
/// the inverse of [`find_attachment_by_scan_key`] (which keys on the path
/// because it starts from a file on disk).
pub(super) async fn find_attachment_by_uuid(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    library_path: &str,
    uuid: &str,
) -> Result<Option<(i64, String)>, sqlx::Error> {
    let row: Option<(i64, String)> = sqlx::query_as(
        "SELECT book_id, COALESCE(scan_key, '') FROM merged_uuids
          WHERE uuid = ? AND library_path = ?",
    )
    .bind(uuid)
    .bind(library_path)
    .fetch_optional(&mut **tx)
    .await?;
    // A ledger row with no `scan_key` predates migration 0026 and has no
    // path for the caller to move off of.
    Ok(row.filter(|(_, scan_key)| !scan_key.is_empty()))
}

/// Does a **different** ledger row already hold `(library_path, scan_key)`? The
/// ledger's counterpart to the `books`-side `idx_books_scan_key` pre-check:
/// `merged_uuids` has only the non-unique `idx_merged_uuids_library_scan`, so a
/// blind relocation would leave two rows sharing one key and a later scan would
/// resolve the path to an arbitrary one ([`find_attachment_by_scan_key`]).
pub(super) async fn attachment_scan_key_taken(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    library_path: &str,
    scan_key: &str,
    uuid: &str,
) -> Result<bool, sqlx::Error> {
    let hit: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM merged_uuids
          WHERE library_path = ? AND scan_key = ? AND uuid <> ? LIMIT 1",
    )
    .bind(library_path)
    .bind(scan_key)
    .bind(uuid)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(hit.is_some())
}

/// Repoint an attachment's ledger row at `new_scan_key` after its file
/// moved. The uuid is the row's durable handle, so it is deliberately left
/// alone — re-deriving it from the new path would orphan the attachment.
pub(super) async fn relocate_attachment(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    uuid: &str,
    new_scan_key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE merged_uuids SET scan_key = ? WHERE uuid = ?")
        .bind(new_scan_key)
        .bind(uuid)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Conservative title+author match for a brand-new file: the book it should
/// attach to, if there is **exactly one** candidate with the same normalized
/// title and author and no `format` file yet. Ambiguity returns `None` (a
/// duplicate the admin can merge beats a guess). Global across libraries; returns
/// the candidate's uuid with its id for the relocation check against Removed.
pub(super) async fn find_attach_target(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    title_norm: &str,
    author_norm: &str,
    format: &str,
) -> Result<Option<(i64, String)>, sqlx::Error> {
    let candidates: Vec<(i64, String)> = sqlx::query_as(
        "SELECT b.id, b.uuid FROM books b
          WHERE b.title_norm = ?1 AND b.author_norm = ?2
            AND NOT EXISTS (SELECT 1 FROM book_files bf
                            WHERE bf.book_id = b.id AND bf.format = ?3)
          ORDER BY b.id LIMIT 2",
    )
    .bind(title_norm)
    .bind(author_norm)
    .bind(format)
    .fetch_all(&mut **tx)
    .await?;
    if candidates.len() == 1 {
        Ok(candidates.into_iter().next())
    } else {
        Ok(None)
    }
}

/// Return whether another file holds the `(book_id, format)` attachment slot; the
/// incoming `scan_key` is excluded so re-attaching the same file proceeds. Both
/// `merged_uuids` and `book_files` are consulted: the ledger never records a
/// book's own native file, so asking it alone let a second on-disk copy evict
/// that file and trade the slot back each scan, restamping `books.last_modified`.
pub(super) async fn slot_held_by_other(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    book_id: i64,
    format: &str,
    scan_key: &str,
) -> Result<bool, sqlx::Error> {
    // Two `EXISTS` subqueries rather than a `UNION ALL … LIMIT 1`: each one
    // short-circuits on its first hit without planning a compound query, and
    // the ledger side — the common case — settles it before `book_files` is
    // touched at all.
    let held: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM merged_uuids
                        WHERE book_id = ? AND format = ? AND scan_key <> ?)
             OR EXISTS(SELECT 1 FROM book_files
                        WHERE book_id = ? AND format = ? AND scan_key <> ?)",
    )
    .bind(book_id)
    .bind(format)
    .bind(scan_key)
    .bind(book_id)
    .bind(format)
    .bind(scan_key)
    .fetch_one(&mut **tx)
    .await?;
    Ok(held != 0)
}

/// Drop the `merged_uuids` row for `(library_path, scan_key)`. Called when a
/// file that previously recorded an attachment is being demoted to its own
/// book (its slot got taken by another file), so its stale ledger entry
/// doesn't keep replaying the attach on every future scan.
pub(super) async fn forget_attachment(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    library_path: &str,
    scan_key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM merged_uuids WHERE library_path = ? AND scan_key = ?")
        .bind(library_path)
        .bind(scan_key)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Record (or refresh) the `merged_uuids` row for an attached file.
/// `library_path` is the scanned root of the *file*, not the target
/// book's library — the reindex diff filters on it. `scan_key` is the
/// attached file's relative path: the diff key the reindex matches on,
/// so the attachment survives a repoint of the file's scan root.
pub(super) async fn record_attachment(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    uuid: &str,
    book_id: i64,
    format: &str,
    library_path: &str,
    scan_key: &str,
) -> Result<(), sqlx::Error> {
    // Reuse the uuid of any existing ledger row for the same
    // `(library_path, scan_key)` so a repoint-recomputed `uuid` can't insert a
    // *duplicate* row for the same attached file — the ledger is keyed on the
    // repoint-stable relative path, and `uuid` is just its stored handle.
    let existing: Option<String> =
        sqlx::query_scalar("SELECT uuid FROM merged_uuids WHERE library_path = ? AND scan_key = ?")
            .bind(library_path)
            .bind(scan_key)
            .fetch_optional(&mut **tx)
            .await?;
    let row_uuid = existing.as_deref().unwrap_or(uuid);
    sqlx::query(
        "INSERT OR REPLACE INTO merged_uuids (uuid, book_id, format, library_path, scan_key)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(row_uuid)
    .bind(book_id)
    .bind(format)
    .bind(library_path)
    .bind(scan_key)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Adopt the new file's cover for the target book when the target has
/// none. Returns the post-commit cover triple (keyed by the **target's**
/// uuid — cover files are uuid-named) when adoption happened.
pub(super) async fn maybe_adopt_cover(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    book_id: i64,
    cover: Option<&(String, Vec<u8>)>,
) -> Result<Option<(String, String, Vec<u8>)>, sqlx::Error> {
    let Some((mime, bytes)) = cover else {
        return Ok(None);
    };
    let row: Option<(String, i64)> =
        sqlx::query_as("SELECT uuid, has_cover FROM books WHERE id = ?")
            .bind(book_id)
            .fetch_optional(&mut **tx)
            .await?;
    let Some((target_uuid, has_cover)) = row else {
        return Ok(None);
    };
    if has_cover != 0 {
        return Ok(None);
    }
    sqlx::query("UPDATE books SET has_cover = 1 WHERE id = ?")
        .bind(book_id)
        .execute(&mut **tx)
        .await?;
    // allow: callers hold `cover` borrowed from a `&[IndexedBook]` slice, and
    // adoption is only known after the `has_cover` query above — cloning here
    // (only on adoption) beats cloning unconditionally at every call site;
    // matches the sibling `push_cover` in `db/src/sync.rs`.
    Ok(Some((target_uuid, mime.clone(), bytes.clone())))
}

/// Drop the attached `book_files` rows (and `merged_uuids` entries) for removed
/// uuids: the companion to `sync_removed`'s `DELETE FROM books`, which no-ops for
/// attachments since they have no `books` row of their own. Scoped per file on
/// `(book_id, scan_key)`, so removing one multi-part `.m4b` sibling leaves the
/// other parts attached. The target book survives (possibly fileless).
pub(super) async fn remove_attached_files(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    removed_uuids: &[String],
) -> Result<(), sqlx::Error> {
    for chunk in removed_uuids.chunks(500) {
        let placeholders = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let files_sql = format!(
            "DELETE FROM book_files WHERE id IN
                (SELECT bf.id FROM book_files bf
                   JOIN merged_uuids mu
                     ON mu.book_id = bf.book_id AND mu.scan_key = bf.scan_key
                  WHERE mu.uuid IN ({placeholders}))"
        );
        let mut q = sqlx::query(&files_sql);
        for uuid in chunk {
            q = q.bind(uuid);
        }
        q.execute(&mut **tx).await?;

        let mu_sql = format!("DELETE FROM merged_uuids WHERE uuid IN ({placeholders})");
        let mut q = sqlx::query(&mu_sql);
        for uuid in chunk {
            q = q.bind(uuid);
        }
        q.execute(&mut **tx).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
