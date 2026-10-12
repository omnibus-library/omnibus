//! The merge transaction: move every satellite row from the source book
//! to the target, snapshot the source into `merge_log`, and delete the
//! source row — all-or-nothing.

use sqlx::{SqlitePool, Transaction};

use crate::covers::{find_cover_file, write_cover_file};
use crate::sync::delete_fts;

use super::snapshot::{build_snapshot, SourceSnapshot};
use super::{curation, links, overrides, relocation};
use super::{MergeError, MergeOutcome};

/// Merge the book identified by `source_uuid` into the one identified by
/// `target_uuid`. The target's metadata (scanned and overridden) wins; the
/// source's files, links, identifiers, progress, and history move over; the
/// source row is deleted and snapshotted into `merge_log` for undo. Same-format
/// files are allowed: the source's are appended after the target's.
pub async fn merge_books(
    pool: &SqlitePool,
    source_uuid: &str,
    target_uuid: &str,
    merged_by: Option<i64>,
) -> Result<MergeOutcome, MergeError> {
    if source_uuid == target_uuid {
        return Err(MergeError::SameBook);
    }
    let mut tx = pool.begin().await?;

    let (source_id, target_id, mut snapshot) =
        snapshot_source_book(&mut tx, source_uuid, target_uuid).await?;

    migrate_book_files(&mut tx, source_id, target_id, &snapshot).await?;
    // A target left under the Physical pseudo-root is invisible to All Books/search.
    crate::physical::promote_filed_physical_book(&mut tx, target_id).await?;
    snapshot.links_added_to_target = links::move_links(&mut tx, source_id, target_id).await?;
    let relocated = relocation::capture_pre(&mut tx, source_uuid, target_uuid).await?;
    move_progress_and_history(&mut tx, source_id, target_id).await?;
    // These record what the preceding step *did*, so they run after it and
    // before `finalize_merge` serializes the snapshot.
    snapshot.relocation = relocation::capture_post(&mut tx, target_uuid, relocated).await?;
    curation::capture_post(&mut tx, target_uuid, &mut snapshot.curation).await?;
    snapshot.identifiers_added_to_target = move_identifiers(&mut tx, source_id, target_id).await?;
    snapshot.overrides =
        overrides::merge_overrides(&mut tx, source_uuid, target_uuid, merged_by).await?;
    let adopt_cover = adopt_cover_flag(&mut tx, source_id, target_id).await?;

    // FTS5 has no FK cascade; clear the source row explicitly via the
    // door. The target's row is rebuilt post-commit with the unioned
    // links.
    delete_fts(&mut tx, source_id).await?;

    rewire_merged_uuid_refs(&mut tx, source_id, target_id, source_uuid, &snapshot).await?;

    let merge_log_id = finalize_merge(&mut tx, target_id, source_id, &snapshot, merged_by).await?;

    tx.commit().await?;

    run_post_commit_side_effects(pool, source_uuid, target_uuid, adopt_cover).await;

    Ok(MergeOutcome {
        merge_log_id,
        target_uuid: target_uuid.to_owned(),
    })
}

/// Re-point `merged_uuids` from source to target and plant per-format guard rows.
///
/// Must run before `finalize_merge` deletes the source `books` row — that
/// delete cascades through `merged_uuids`.
async fn rewire_merged_uuid_refs(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_id: i64,
    target_id: i64,
    source_uuid: &str,
    snapshot: &SourceSnapshot,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE merged_uuids SET book_id = ? WHERE book_id = ?")
        .bind(target_id)
        .bind(source_id)
        .execute(&mut **tx)
        .await?;
    // The source file's relative path (F2 scan_key) so the next reindex
    // recognizes the now-attached file by scan_key and classifies it
    // Unchanged instead of resurrecting a duplicate.
    let source_scan_key: Option<String> =
        sqlx::query_scalar("SELECT scan_key FROM books WHERE id = ?")
            .bind(source_id)
            .fetch_optional(&mut **tx)
            .await?;
    // Bounded by a book's native format count (typically 1-2), so this stays
    // a per-format loop rather than a batched multi-row insert.
    for fmt in &snapshot.native_formats {
        sqlx::query(
            "INSERT OR REPLACE INTO merged_uuids (uuid, book_id, format, library_path, scan_key)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(source_uuid)
        .bind(target_id)
        .bind(fmt)
        .bind(&snapshot.library_path)
        .bind(&source_scan_key)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Best-effort post-commit fixups: cover adopt + target FTS rebuild; failures are logged, not propagated.
async fn run_post_commit_side_effects(
    pool: &SqlitePool,
    source_uuid: &str,
    target_uuid: &str,
    adopt_cover: bool,
) {
    if adopt_cover {
        let src = source_uuid.to_owned();
        let tgt = target_uuid.to_owned();
        let _ = tokio::task::spawn_blocking(move || {
            if let Some((mime, bytes)) = find_cover_file(&src) {
                if let Err(e) = write_cover_file(&tgt, &mime, &bytes) {
                    tracing::warn!(error = %e, uuid = %tgt, "merge: cover adopt copy failed");
                }
            }
        })
        .await;
    }
    if let Err(e) =
        crate::metadata_overrides::rebuild_fts_for_books_batch(pool, &[target_uuid.to_owned()])
            .await
    {
        tracing::warn!(error = %e, uuid = %target_uuid, "merge: target FTS rebuild failed");
    }
}

/// Resolve both uuids to row ids, re-check same-book, then freeze the
/// source book's metadata into a [`SourceSnapshot`] for the merge log.
async fn snapshot_source_book(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_uuid: &str,
    target_uuid: &str,
) -> Result<(i64, i64, SourceSnapshot), MergeError> {
    let source_id = resolve_book(tx, source_uuid).await?;
    let target_id = resolve_book(tx, target_uuid).await?;
    if source_id == target_id {
        return Err(MergeError::SameBook);
    }
    let snapshot = build_snapshot(tx, source_id, target_uuid).await?;
    Ok((source_id, target_id, snapshot))
}

/// Re-parent the source's `book_files` onto the target and renormalize
/// the moved rows' ordinals/labels.
async fn migrate_book_files(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_id: i64,
    target_id: i64,
    snapshot: &SourceSnapshot,
) -> Result<(), sqlx::Error> {
    move_book_files(
        tx,
        source_id,
        target_id,
        &snapshot.library_path,
        &snapshot.path,
    )
    .await?;
    assign_ordinals_after_move(tx, target_id, &snapshot.title).await?;
    Ok(())
}

/// Append the merge-log entry and delete the source book row. Returns
/// the new `merge_log.id` (the undo handle).
async fn finalize_merge(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    target_id: i64,
    source_id: i64,
    snapshot: &SourceSnapshot,
    merged_by: Option<i64>,
) -> Result<i64, MergeError> {
    let merge_log_id: i64 = sqlx::query_scalar(
        "INSERT INTO merge_log (target_book_id, source_uuid, source_metadata, merged_by)
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(target_id)
    .bind(&snapshot.uuid)
    .bind(serde_json::to_string(snapshot)?)
    .bind(merged_by)
    .fetch_one(&mut **tx)
    .await?;

    sqlx::query("DELETE FROM books WHERE id = ?")
        .bind(source_id)
        .execute(&mut **tx)
        .await?;

    // The source's authors/series/tags were copied to the target above; prune
    // any taxonomy the source delete left referencing zero books.
    crate::taxonomy::delete_orphan_taxonomy(tx).await?;

    Ok(merge_log_id)
}

/// Resolve a uuid to its `books.id` — real rows only, no `merged_uuids`
/// fallback (you can't merge a book that no longer exists).
async fn resolve_book(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    uuid: &str,
) -> Result<i64, MergeError> {
    sqlx::query_scalar::<_, i64>("SELECT id FROM books WHERE uuid = ?")
        .bind(uuid)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| MergeError::BookNotFound(uuid.to_owned()))
}

/// Sentinel offset added by `move_book_files` to source ordinals before
/// the re-parent, preventing UNIQUE constraint violations during the move.
const ORDINAL_OFFSET: i64 = 1000;

/// After re-parenting source files onto the target, assign clean ordinals
/// to moved files. Moved files carry temporary ordinals (>= ORDINAL_OFFSET)
/// from `move_book_files`; this normalizes them to consecutive values
/// starting after the target's existing files. Their `label` is set to
/// the source book's title so the file picker shows a meaningful name.
async fn assign_ordinals_after_move(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    target_id: i64,
    source_title: &str,
) -> Result<(), sqlx::Error> {
    let formats_with_moves: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT format FROM book_files
          WHERE book_id = ? AND ordinal >= ?",
    )
    .bind(target_id)
    .bind(ORDINAL_OFFSET)
    .fetch_all(&mut **tx)
    .await?;

    for fmt in &formats_with_moves {
        let max_existing: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(ordinal), -1) FROM book_files
              WHERE book_id = ? AND format = ? AND ordinal < ?",
        )
        .bind(target_id)
        .bind(fmt)
        .bind(ORDINAL_OFFSET)
        .fetch_one(&mut **tx)
        .await?;

        let moved_ids: Vec<i64> = sqlx::query_scalar(
            "SELECT id FROM book_files
              WHERE book_id = ? AND format = ? AND ordinal >= ?
              ORDER BY ordinal, filename",
        )
        .bind(target_id)
        .bind(fmt)
        .bind(ORDINAL_OFFSET)
        .fetch_all(&mut **tx)
        .await?;

        batch_assign_ordinals(tx, &moved_ids, max_existing, source_title).await?;
    }
    Ok(())
}

/// Rows per chunk in `batch_assign_ordinals`. Each row costs three binds
/// (two in the `CASE`, one in the `IN` list) plus one shared label bind, so
/// 200 keeps a chunk comfortably under SQLite's 999-parameter cap.
const ORDINAL_CHUNK: usize = 200;

/// Assign consecutive ordinals to `moved_ids` — in the given order, starting
/// at `max_existing + 1` — via a single `CASE`-based UPDATE per chunk,
/// stamping `source_title` as the label on any file that still has none.
/// Chunked so a pathologically large move can't exceed SQLite's bind cap.
async fn batch_assign_ordinals(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    moved_ids: &[i64],
    max_existing: i64,
    source_title: &str,
) -> Result<(), sqlx::Error> {
    for (chunk_idx, chunk) in moved_ids.chunks(ORDINAL_CHUNK).enumerate() {
        let base = max_existing + 1 + (chunk_idx * ORDINAL_CHUNK) as i64;
        let cases = std::iter::repeat_n("WHEN ? THEN ?", chunk.len())
            .collect::<Vec<_>>()
            .join(" ");
        let placeholders = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "UPDATE book_files SET ordinal = CASE id {cases} END,
                    label = COALESCE(label, ?)
              WHERE id IN ({placeholders})"
        );
        let mut q = sqlx::query(&sql);
        for (i, file_id) in chunk.iter().enumerate() {
            q = q.bind(file_id).bind(base + i as i64);
        }
        q = q.bind(source_title);
        for file_id in chunk {
            q = q.bind(file_id);
        }
        q.execute(&mut **tx).await?;
    }
    Ok(())
}

/// Re-parent the source's `book_files` rows (parts and chapters follow
/// via their `book_file_id` FK). To avoid violating the
/// `UNIQUE(book_id, format, ordinal)` constraint, source files are given
/// temporary high ordinals before the re-parent; `assign_ordinals_after_move`
/// cleans them up to consecutive values.
async fn move_book_files(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_id: i64,
    target_id: i64,
    source_library_path: &str,
    source_path: &str,
) -> Result<(), sqlx::Error> {
    let max_target: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(ordinal), -1) FROM book_files WHERE book_id = ?")
            .bind(target_id)
            .fetch_one(&mut **tx)
            .await?;

    // Offset source ordinals so they land above anything on the target,
    // preventing collisions during the re-parent UPDATE.
    sqlx::query("UPDATE book_files SET ordinal = ordinal + ?1 WHERE book_id = ?2")
        .bind(max_target + ORDINAL_OFFSET)
        .bind(source_id)
        .execute(&mut **tx)
        .await?;

    sqlx::query(
        "UPDATE book_files SET
            book_id = ?1,
            library_path = COALESCE(library_path, ?3),
            path = COALESCE(path, ?4)
         WHERE book_id = ?2",
    )
    .bind(target_id)
    .bind(source_id)
    .bind(source_library_path)
    .bind(source_path)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Every table that soft-references `books.uuid` and must follow the book
/// across a merge. This list is the merge's half of the soft-reference
/// contract: a table keyed on `book_uuid` that is in neither it nor
/// [`MERGE_EXEMPT_TABLES`] strands its rows on the deleted source uuid, and
/// `merge_settles_every_book_uuid_table` fails on it.
pub(super) const RETARGET_TABLES: [&str; 18] = [
    "reading_progress",
    "reading_progress_marks",
    "reading_progress_daily",
    "reading_progress_slots",
    "audiobook_playback_preferences",
    "bookmarks",
    "reading_sessions",
    "listening_sessions",
    "annotations",
    "kobo_annotations_sync",
    "journal_entries",
    "book_read_status",
    "user_ratings",
    "shelf_books",
    "physical_copies",
    "wishlist_entries",
    "cross_format_links",
    "book_content_chapters",
];

/// The `book_uuid`-keyed tables the merge deliberately leaves alone, each
/// with the reason. Not a list to grow casually: an entry here means the rows
/// the source leaves behind were judged harmless, and
/// `merge_settles_every_book_uuid_table` holds the schema to it.
// Only that test reads it; it lives here so the reason sits beside the list.
#[cfg_attr(not(test), allow(dead_code))]
pub(super) const MERGE_EXEMPT_TABLES: [(&str, &str); 4] = [
    (
        "metadata_overrides",
        "settled by `overrides::merge_overrides` in the same transaction and parked in the snapshot for undo",
    ),
    (
        "book_suggestions",
        "regenerable suggestion cache; the target keeps its own and the source's rows are unreachable",
    ),
    (
        "book_suggestion_state",
        "regenerable suggestion cache; the target keeps its own and the source's rows are unreachable",
    ),
    (
        "kobo_books_sync",
        "per-device sync snapshot: the stranded row is what tells the device on its next sync that the source entitlement is gone",
    ),
];

/// Which of two rows survives a `UNIQUE` collision once the source's uuid
/// retargets onto the target's.
#[derive(Clone, Copy)]
pub(super) enum Keep {
    /// The row with the greater `column`; ties go to the target.
    Max(&'static str),
    /// The row with the smaller `column`; ties go to the target.
    Min(&'static str),
    /// The target's row, unconditionally.
    Target,
}

/// A [`RETARGET_TABLES`] entry whose `UNIQUE` key the retarget would violate:
/// the key's columns beyond `book_uuid`, and the rule that picks the survivor.
pub(super) struct Collision {
    pub table: &'static str,
    pub keys: &'static [&'static str],
    pub keep: Keep,
}

/// The subset of [`RETARGET_TABLES`] with a `UNIQUE` key to settle, resolved by
/// [`dedupe_collisions`] before the retarget runs. A dedupe is destructive, so
/// it is reversible only if the merge wrote both sides down first: curation in
/// [`super::curation`], every other entry in [`super::relocation`] (the content
/// index is regenerated).
pub(super) const COLLISION_TABLES: [Collision; 9] = [
    Collision {
        table: "reading_progress",
        keys: &["user_id", "format"],
        keep: Keep::Max("updated_at"),
    },
    // The forward-progress mark is a snapshot of a position, exactly like the
    // progress row it shadows, so latest-wins is the same right answer here.
    // Its day buckets are not — see `fold_ledger_counters`.
    Collision {
        table: "reading_progress_marks",
        keys: &["user_id", "format"],
        keep: Keep::Max("updated_at"),
    },
    Collision {
        table: "audiobook_playback_preferences",
        keys: &["user_id"],
        keep: Keep::Max("updated_at"),
    },
    Collision {
        table: "book_read_status",
        keys: &["user_id"],
        keep: Keep::Max("updated_at"),
    },
    Collision {
        table: "user_ratings",
        keys: &["user_id"],
        keep: Keep::Max("updated_at"),
    },
    // Both editions on one shelf: the book keeps the earlier slot, so a shelf
    // someone ordered by hand doesn't reshuffle under them.
    Collision {
        table: "shelf_books",
        keys: &["shelf_id"],
        keep: Keep::Min("position"),
    },
    // Wanting both editions is wanting the book once; the earlier entry is the
    // original statement of it.
    Collision {
        table: "wishlist_entries",
        keys: &["user_id"],
        keep: Keep::Min("added_at"),
    },
    // A link pins the audio file set it was confirmed against, and the merge
    // changes that set on the target either way — so both links pause until
    // re-confirmed. The target's is at least about files the survivor holds.
    Collision {
        table: "cross_format_links",
        keys: &["user_id"],
        keep: Keep::Target,
    },
    // The format-collision check admits one text file per book, so a target
    // with chapters indexed its own; the source's could only come from a file
    // the target has no room for.
    Collision {
        table: "book_content_chapters",
        keys: &["spine_index"],
        keep: Keep::Target,
    },
];

/// Re-parent every row keyed on the source's uuid onto the target (reader
/// state, shelf memberships, copies, wishlist entries, cross-format links, the
/// content index) with `UPDATE ... SET book_uuid = <target>`. Tables with a
/// `UNIQUE` key the retarget would violate are deduped first; see
/// [`COLLISION_TABLES`] and [`dedupe_collisions`].
async fn move_progress_and_history(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_id: i64,
    target_id: i64,
) -> Result<(), sqlx::Error> {
    // Read both uuids while the source row still exists; `finalize_merge`
    // deletes it later.
    let source_uuid: String = sqlx::query_scalar("SELECT uuid FROM books WHERE id = ?")
        .bind(source_id)
        .fetch_one(&mut **tx)
        .await?;
    let target_uuid: String = sqlx::query_scalar("SELECT uuid FROM books WHERE id = ?")
        .bind(target_id)
        .fetch_one(&mut **tx)
        .await?;

    // Before the dedupe, which is what makes the readers it applies to
    // identifiable — afterwards the losing row is gone.
    clear_sitting_clock(tx, &source_uuid, &target_uuid).await?;
    for collision in &COLLISION_TABLES {
        dedupe_collisions(tx, collision, &source_uuid, &target_uuid).await?;
    }
    fold_ledger_counters(tx, &source_uuid, &target_uuid).await?;
    // Per-device annotation sync state keys on (device_id, book_uuid) rather
    // than on a user, so it can't use the latest-wins helper. Where a device
    // tracks BOTH uuids, keep the target's row (the retarget below would
    // collide) — the watermark is regenerable, and a moved fingerprint just
    // re-reports the merged book once.
    sqlx::query(
        "DELETE FROM kobo_annotations_sync
          WHERE book_uuid = ?2 AND EXISTS (
            SELECT 1 FROM kobo_annotations_sync t
             WHERE t.book_uuid = ?1
               AND t.device_id = kobo_annotations_sync.device_id)",
    )
    .bind(&target_uuid)
    .bind(&source_uuid)
    .execute(&mut **tx)
    .await?;
    for table in RETARGET_TABLES {
        let sql = format!("UPDATE {table} SET book_uuid = ?1 WHERE book_uuid = ?2");
        sqlx::query(&sql)
            .bind(&target_uuid)
            .bind(&source_uuid)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

/// The two forward-progress counter tables and the column each buckets on —
/// `0083`'s frozen day buckets and `0095`'s quarter-hour slots, which replaced
/// them so the day could be resolved at read time. Both generations are still
/// read, so both have to survive a merge.
pub(super) const LEDGER_COUNTER_TABLES: [(&str, &str); 2] = [
    ("reading_progress_daily", "day"),
    ("reading_progress_slots", "slot"),
];

/// Fold the source book's forward-progress buckets into the target's, clearing
/// the collisions the retarget would otherwise hit. **Summed, not deduped:**
/// every other colliding table holds a snapshot where newest-wins is right, but
/// these hold a *counter*, so latest-wins would throw one side's reading away.
/// Consumed source rows are deleted, so the retarget moves only the rest.
async fn fold_ledger_counters(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_uuid: &str,
    target_uuid: &str,
) -> Result<(), sqlx::Error> {
    for (table, bucket) in LEDGER_COUNTER_TABLES {
        // `table` and `bucket` are fixed literals from the array above, never
        // user input.
        let sql = format!(
            "UPDATE {table} AS t
                SET percent_gained = t.percent_gained + (
                        SELECT SUM(s.percent_gained) FROM {table} s
                         WHERE s.book_uuid = ?2 AND s.user_id = t.user_id
                           AND s.{bucket} = t.{bucket} AND s.format = t.format)
              WHERE t.book_uuid = ?1
                AND EXISTS (SELECT 1 FROM {table} s
                             WHERE s.book_uuid = ?2 AND s.user_id = t.user_id
                               AND s.{bucket} = t.{bucket} AND s.format = t.format)"
        );
        sqlx::query(&sql)
            .bind(target_uuid)
            .bind(source_uuid)
            .execute(&mut **tx)
            .await?;

        let sql = format!(
            "DELETE FROM {table}
              WHERE book_uuid = ?2 AND EXISTS (
                SELECT 1 FROM {table} t
                 WHERE t.book_uuid = ?1 AND t.user_id = {table}.user_id
                   AND t.{bucket} = {table}.{bucket}
                   AND t.format = {table}.format)"
        );
        sqlx::query(&sql)
            .bind(target_uuid)
            .bind(source_uuid)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

/// Unset the forward-progress sitting clock for the readers whose surviving
/// mark the dedupe is about to choose between, so their next observation on the
/// merged book re-baselines. Scoped to `(reader, format)` pairs holding a mark
/// on **both** books, and must run *before* the dedupe: afterwards one of the
/// two rows is gone and those pairs are no longer identifiable.
async fn clear_sitting_clock(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_uuid: &str,
    target_uuid: &str,
) -> Result<(), sqlx::Error> {
    // A mark is a ceiling on accrual, so a 90%-read source winning over a 10%-read
    // target would suppress every gain below 90%. Only pairs holding both marks
    // are cleared; a reader-wide clear would re-baseline sittings left untouched.
    sqlx::query(
        "UPDATE reading_progress_marks SET sitting_observed_at = NULL
          WHERE book_uuid IN (?1, ?2)
            AND (user_id, format) IN (
                SELECT user_id, format FROM reading_progress_marks WHERE book_uuid = ?1
                INTERSECT
                SELECT user_id, format FROM reading_progress_marks WHERE book_uuid = ?2
            )",
    )
    .bind(source_uuid)
    .bind(target_uuid)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Settle one table's `UNIQUE` collisions per its [`Keep`] rule, so the blanket
/// retarget that follows never violates the key. Two passes, in this order:
/// pass 2's blanket delete of colliding target rows is only correct once pass 1
/// has removed the source rows the target already beat.
async fn dedupe_collisions(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    collision: &Collision,
    source_uuid: &str,
    target_uuid: &str,
) -> Result<(), sqlx::Error> {
    // Table and column names are fixed literals from `COLLISION_TABLES`, never
    // user input.
    let table = collision.table;
    let same_key: String = collision
        .keys
        .iter()
        .map(|k| format!(" AND o.{k} = {table}.{k}"))
        .collect();
    let target_wins = match collision.keep {
        Keep::Max(col) => format!(" AND o.{col} >= {table}.{col}"),
        Keep::Min(col) => format!(" AND o.{col} <= {table}.{col}"),
        Keep::Target => String::new(),
    };

    // Losing source rows first …
    let sql = format!(
        "DELETE FROM {table} WHERE book_uuid = ?2 AND EXISTS (
            SELECT 1 FROM {table} o
             WHERE o.book_uuid = ?1{same_key}{target_wins})"
    );
    sqlx::query(&sql)
        .bind(target_uuid)
        .bind(source_uuid)
        .execute(&mut **tx)
        .await?;

    // … then the target rows a surviving source row beat. Under `Keep::Target`
    // no source row survives a collision, so there is nothing to do.
    if matches!(collision.keep, Keep::Target) {
        return Ok(());
    }
    let sql = format!(
        "DELETE FROM {table} WHERE book_uuid = ?1 AND EXISTS (
            SELECT 1 FROM {table} o
             WHERE o.book_uuid = ?2{same_key})"
    );
    sqlx::query(&sql)
        .bind(target_uuid)
        .bind(source_uuid)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Union identifiers; the target's value wins per `(book_id, scheme)`. The
/// source's own rows cascade with the source delete. Returns the
/// `(scheme, value)` tuples the union actually **added** to the target, so undo
/// can take exactly those back off it; tuples the target already carried did
/// not come from the merge, so they are not the merge's to remove.
async fn move_identifiers(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_id: i64,
    target_id: i64,
) -> Result<Vec<(String, String)>, sqlx::Error> {
    // Same `(scheme, value)` comparison the `OR IGNORE` below resolves against
    // — both columns are `COLLATE NOCASE`, so this matches the PK's own notion
    // of a duplicate rather than a stricter one.
    let added: Vec<(String, String)> = sqlx::query_as(
        "SELECT s.scheme, s.value FROM book_identifiers s
          WHERE s.book_id = ?2
            AND NOT EXISTS (SELECT 1 FROM book_identifiers t
                             WHERE t.book_id = ?1 AND t.scheme = s.scheme AND t.value = s.value)",
    )
    .bind(target_id)
    .bind(source_id)
    .fetch_all(&mut **tx)
    .await?;

    sqlx::query(
        "INSERT OR IGNORE INTO book_identifiers (book_id, scheme, value)
         SELECT ?1, scheme, value FROM book_identifiers WHERE book_id = ?2",
    )
    .bind(target_id)
    .bind(source_id)
    .execute(&mut **tx)
    .await?;
    Ok(added)
}

/// Cover precedence: target wins; adopt the source's scanned cover only
/// when the target has none. Returns whether the post-commit file copy
/// should run.
async fn adopt_cover_flag(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_id: i64,
    target_id: i64,
) -> Result<bool, sqlx::Error> {
    let (source_has, target_has): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT has_cover FROM books WHERE id = ?1),
                (SELECT has_cover FROM books WHERE id = ?2)",
    )
    .bind(source_id)
    .bind(target_id)
    .fetch_one(&mut **tx)
    .await?;
    if source_has != 0 && target_has == 0 {
        sqlx::query("UPDATE books SET has_cover = 1 WHERE id = ?")
            .bind(target_id)
            .execute(&mut **tx)
            .await?;
        return Ok(true);
    }
    Ok(false)
}
