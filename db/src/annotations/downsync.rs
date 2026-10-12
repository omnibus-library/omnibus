//! Web→Kobo annotation materialization: rows holding only an
//! `epub_cfi_range` get a derived `kobo_location` (and a minted
//! `client_id`) so the Reading Services channel can serve them to a
//! device. The serving queries never change — a materialized row simply
//! starts matching `kobo_location IS NOT NULL`.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};

use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::kobo_position::annotation_locations;
use crate::worker::{Task, Worker};

/// Process-wide guard for [`spawn_kobo_downsync`]: the key of every
/// `(user_id, book_uuid)` pair with a materialization task currently
/// in flight.
fn inflight_downsyncs() -> &'static Mutex<HashSet<(i64, String)>> {
    static INFLIGHT: OnceLock<Mutex<HashSet<(i64, String)>>> = OnceLock::new();
    INFLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Removes its key from [`inflight_downsyncs`] on drop, not just on the
/// task's normal-completion path — so a panic inside the task, or the task
/// being aborted, still releases the key instead of permanently suppressing
/// future downsyncs for it.
struct InflightGuard {
    key: (i64, String),
}

impl Drop for InflightGuard {
    fn drop(&mut self) {
        inflight_downsyncs()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.key);
    }
}

/// What one materialization pass accomplished, for logs.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DownsyncStats {
    /// Rows that now carry a derived Kobo anchor.
    pub derived: usize,
    /// Candidate rows left without one (point/unparseable CFI, missing
    /// kepub cache or source file, or a derivation miss).
    pub unresolved: usize,
}

/// Materialize `kobo_location` for one (user, book): derive a KoboSpan range
/// for every candidate row in one batch, minting a `client_id` where missing.
/// Never touches `updated_at`, so the device re-pulls without a fabricated
/// edit time. `worker` requests a KEPUB conversion on a cold cache (rows stay
/// unresolved without one); pass `None` only from the post-conversion hook or a test.
pub async fn downsync_book_annotations(
    pool: &SqlitePool,
    worker: Option<&Arc<Worker>>,
    user_id: i64,
    book_uuid: &str,
) -> anyhow::Result<DownsyncStats> {
    let rows = sqlx::query_as::<_, (i64, String)>(
        "SELECT id, epub_cfi_range FROM annotations
         WHERE user_id = ? AND book_uuid = ?
           AND epub_cfi_range LIKE 'epubcfi(%' AND kobo_location IS NULL",
    )
    .bind(user_id)
    .bind(book_uuid)
    .fetch_all(pool)
    .await?;
    if rows.is_empty() {
        return Ok(DownsyncStats::default());
    }
    let mut stats = DownsyncStats {
        derived: 0,
        unresolved: rows.len(),
    };

    let Some(book_id) = crate::resolve_book_id_by_uuid(pool, book_uuid).await? else {
        return Ok(stats);
    };
    let kepub = crate::kepub_path(book_id);
    if !tokio::fs::try_exists(&kepub).await.unwrap_or(false) {
        // Idempotent and serialized per book by the worker; do NOT await —
        // callers are a write path or a boot pass, and the conversion's own
        // completion re-runs this via `downsync_book_id_annotations`.
        // Mirrors `derive_span_for_cfi` on the reading-state path.
        if let Some(worker) = worker {
            worker.post(Task::KepubConvert { book_id });
        }
        return Ok(stats);
    }
    let Some(source) = crate::book_file_path(pool, book_id, "EPUB").await? else {
        return Ok(stats);
    };

    let cfis: Vec<String> = rows.iter().map(|(_, cfi)| cfi.clone()).collect();
    let locations =
        tokio::task::spawn_blocking(move || annotation_locations(&kepub, &source, &cfis)).await??;

    let candidates: Vec<(i64, String, String)> = rows
        .into_iter()
        .zip(locations)
        .filter_map(|((id, snapshot_cfi), location)| location.map(|loc| (id, snapshot_cfi, loc)))
        .collect();
    if candidates.is_empty() {
        return Ok(stats);
    }

    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let derived = apply_derived_locations(&mut tx, &candidates).await?;
    tx.commit().await?;
    stats.derived += derived;
    stats.unresolved -= derived;
    Ok(stats)
}

/// Rows per chunk for [`apply_derived_locations`]'s batched UPDATE: 4 binds
/// per row (id, location, minted client_id, snapshot cfi) keeps each
/// statement comfortably under SQLite's 999 bound-parameter cap.
const APPLY_CHUNK_SIZE: usize = 200;

/// Persist every derived `(id, snapshot_cfi, location)` in chunked
/// `UPDATE ... FROM (VALUES ...)` statements; returns the rows actually written.
/// A row that gained an anchor or whose CFI moved since the snapshot is left
/// untouched (`kobo_location IS NULL AND epub_cfi_range = <snapshot>`).
async fn apply_derived_locations(
    tx: &mut Transaction<'_, Sqlite>,
    candidates: &[(i64, String, String)],
) -> anyhow::Result<usize> {
    let mut derived = 0;
    for chunk in candidates.chunks(APPLY_CHUNK_SIZE) {
        let rows = std::iter::repeat_n("(?, ?, ?, ?)", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "UPDATE annotations
                SET kobo_location = v.column2,
                    client_id = COALESCE(annotations.client_id, v.column3)
               FROM (VALUES {rows}) AS v
              WHERE annotations.id = v.column1
                AND annotations.kobo_location IS NULL
                AND annotations.epub_cfi_range = v.column4
              RETURNING annotations.id"
        );
        let mut q = sqlx::query_scalar::<_, i64>(&sql);
        for (id, snapshot_cfi, location) in chunk {
            q = q
                .bind(id)
                .bind(location)
                .bind(uuid::Uuid::new_v4().hyphenated().to_string())
                .bind(snapshot_cfi);
        }
        // `RETURNING id` makes the count exact: `rows_affected` can't say which rows
        // in a chunk passed the guard.
        derived += q.fetch_all(&mut **tx).await?.len();
    }
    Ok(derived)
}

/// Boot-time pass: materialize every pending (user, book) pair, retrying rows
/// whose kepub cache was missing or diverged and backlog highlights made before
/// down-sync existed. Cheap once caught up. Passing `worker` requests the
/// conversions a cold cache needs: few, deduped per book by the worker's
/// `kepub:{book_id}` key, and skipped for a warm cache.
pub async fn downsync_all_kobo_annotations(
    pool: &SqlitePool,
    worker: Option<&Arc<Worker>>,
) -> anyhow::Result<DownsyncStats> {
    let pairs: Vec<(i64, String)> = sqlx::query_as(
        "SELECT DISTINCT user_id, book_uuid FROM annotations
         WHERE epub_cfi_range LIKE 'epubcfi(%' AND kobo_location IS NULL",
    )
    .fetch_all(pool)
    .await?;
    let mut stats = DownsyncStats::default();
    for (user_id, book_uuid) in pairs {
        match downsync_book_annotations(pool, worker, user_id, &book_uuid).await {
            Ok(s) => {
                stats.derived += s.derived;
                stats.unresolved += s.unresolved;
            }
            Err(e) => {
                tracing::warn!(user_id, book_uuid, error = %e, "annotation downsync failed for book");
            }
        }
    }
    Ok(stats)
}

/// Materialize every user's pending rows for one book id: the hook the worker
/// runs after a successful KEPUB conversion, so the highlights that conversion
/// was requested for land now rather than on the next write or boot. Requests
/// no conversion of its own: the cache is fresh here, and a failed derivation
/// must not re-enter the task that called it.
pub async fn downsync_book_id_annotations(
    pool: &SqlitePool,
    book_id: i64,
) -> anyhow::Result<DownsyncStats> {
    let Some(book_uuid): Option<String> = sqlx::query_scalar("SELECT uuid FROM books WHERE id = ?")
        .bind(book_id)
        .fetch_optional(pool)
        .await?
    else {
        return Ok(DownsyncStats::default());
    };
    let user_ids: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT user_id FROM annotations
         WHERE book_uuid = ? AND epub_cfi_range LIKE 'epubcfi(%' AND kobo_location IS NULL",
    )
    .bind(&book_uuid)
    .fetch_all(pool)
    .await?;

    let mut stats = DownsyncStats::default();
    for user_id in user_ids {
        let s = downsync_book_annotations(pool, None, user_id, &book_uuid).await?;
        stats.derived += s.derived;
        stats.unresolved += s.unresolved;
    }
    Ok(stats)
}

/// Fire-and-forget materialization after a highlight write, so the caller never
/// waits on an EPUB walk. Coalesced per `(user_id, book_uuid)` via
/// [`inflight_downsyncs`]: a call that finds one running skips the spawn, so a
/// row written after that task read its worklist waits for the next highlight
/// write or the boot-time [`downsync_all_kobo_annotations`] pass.
pub fn spawn_kobo_downsync(
    pool: SqlitePool,
    worker: Option<Arc<Worker>>,
    user_id: i64,
    book_uuid: String,
) {
    let key = (user_id, book_uuid.clone());
    {
        let mut inflight = inflight_downsyncs()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !inflight.insert(key.clone()) {
            return;
        }
    }
    tokio::spawn(async move {
        let _guard = InflightGuard { key };
        if let Err(e) = downsync_book_annotations(&pool, worker.as_ref(), user_id, &book_uuid).await
        {
            tracing::warn!(user_id, book_uuid, error = %e, "annotation downsync failed");
        }
    });
}

#[cfg(test)]
mod tests;
