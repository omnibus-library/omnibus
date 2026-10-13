//! Library-scale totals: how big the collection is in words, pages, and hours
//! of audio. Library-scoped rather than per-`(user_id, range)`, so it carries
//! its own cache. Every total is returned with the count of books behind it —
//! each input has a state meaning *not measured yet*, which a bare `SUM` would
//! read as a confident zero. Served by `server::backend::stats` and `rpc`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use omnibus_shared::{LibrarySize, MeasuredTotal};
use sqlx::{Row, SqlitePool};

use super::{pages, StatsError};

/// How long a computed [`LibrarySize`] is served from cache. [`invalidate`] keeps
/// it fresh; the TTL is the backstop for anything that changes the library without
/// going through the indexer.
// Far longer than the per-user `STATS_TTL_SECS`: a collection changes on a scan,
// not on a sitting.
const LIBRARY_TTL_SECS: i64 = 900;

/// The liveness filter every figure here shares: a `books` row with at least
/// one surviving file. Ghosted rows are excluded from the numerators *and*
/// from the denominator — their bytes are gone, so counting them would both
/// overstate the library and drag every coverage fraction down for rows
/// nothing can measure.
pub(super) const LIVE_BOOK: &str = "EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id)";

/// The audio formats an audiobook can be served from, mirroring
/// `hls::query::resolve_audiobook_file`. A duration total that admitted
/// formats the player can't resolve would describe hours nobody can listen to.
const AUDIO_FORMATS: &str = "('M4B', 'M4A', 'MP3')";

/// One cache entry plus the generation it was computed against, which makes
/// [`invalidate`] stick. A compute runs outside the lock, so an `invalidate` can
/// land mid-flight; the reader stamps the generation it started from and drops
/// its result if the counter has moved.
#[derive(Default)]
struct Cache {
    entry: Mutex<Option<(i64, LibrarySize)>>,
    generation: AtomicU64,
}

/// Process-wide cache. One entry, not a map: the answer is library-wide, so
/// there is nothing to key it on.
fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(Cache::default)
}

/// Drop the cached total. Called when the library itself changes — a reindex
/// is the only thing that moves any of these figures, and waiting out
/// [`LIBRARY_TTL_SECS`] after a scan would show a reader the size of the
/// library they had before it.
pub fn invalidate() {
    invalidate_in(cache());
}

fn invalidate_in(cache: &Cache) {
    // Bump before clearing: a compute that reads the generation after this
    // point must see the new value, whatever order it interleaves in.
    cache.generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut guard) = cache.entry.lock() {
        *guard = None;
    }
}

/// How big the library is in words, pages, and hours of audio, cached for
/// [`LIBRARY_TTL_SECS`].
pub async fn library_size(pool: &SqlitePool) -> Result<LibrarySize, StatsError> {
    library_size_in(cache(), pool, super::now_secs()).await
}

/// Clock- and cache-injected core of [`library_size`], so the cache path is
/// testable without waiting fifteen minutes. The cache is a parameter because the
/// process-wide entry has nothing to key it on, so tests sharing it race
/// (`Worker::execute` drops the entry after any `Task::Scan`).
async fn library_size_in(
    cache: &Cache,
    pool: &SqlitePool,
    now: i64,
) -> Result<LibrarySize, StatsError> {
    if let Some(hit) = cache_get(cache, now) {
        return Ok(hit);
    }
    let generation = cache.generation.load(Ordering::SeqCst);
    let size = compute(pool).await?;
    store_if_current(cache, generation, now, size);
    Ok(size)
}

/// Publish a computed total, unless an [`invalidate`] overtook the compute. A
/// compute that started before the bump is still the caller's own answer, but not
/// one to hand every other reader for the rest of the TTL.
fn store_if_current(cache: &Cache, generation: u64, now: i64, size: LibrarySize) {
    if let Ok(mut guard) = cache.entry.lock() {
        if cache.generation.load(Ordering::SeqCst) == generation {
            *guard = Some((now, size));
        }
    }
}

fn cache_get(cache: &Cache, now: i64) -> Option<LibrarySize> {
    let guard = cache.entry.lock().ok()?;
    let (at, size) = guard.as_ref()?;
    (now.saturating_sub(*at) < LIBRARY_TTL_SECS).then_some(*size)
}

/// Run the four queries and assemble the totals.
async fn compute(pool: &SqlitePool) -> Result<LibrarySize, StatsError> {
    Ok(LibrarySize {
        books: live_book_count(pool).await?,
        words: word_total(pool).await?,
        pages: page_total(pool).await?,
        listening_seconds: listening_total(pool).await?,
    })
}

/// Books with at least one file on disk — the denominator.
pub(super) async fn live_book_count(pool: &SqlitePool) -> Result<i64, StatsError> {
    Ok(
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM books b WHERE {LIVE_BOOK}"))
            .fetch_one(pool)
            .await?,
    )
}

/// Total stored `word_count` and the books behind it. NULL is the no-data sentinel
/// (an audio-only book, a parse failure, or a row `Task::BackfillWordCounts` hasn't
/// reached), so it contributes to neither figure.
async fn word_total(pool: &SqlitePool) -> Result<MeasuredTotal, StatsError> {
    measured(
        pool,
        &format!(
            "SELECT COALESCE(SUM(b.word_count), 0) AS total, COUNT(b.word_count) AS books
             FROM books b WHERE {LIVE_BOOK}"
        ),
    )
    .await
}

/// Total pages, resolved per book through the shared length ladder rather
/// than a fourth private copy of it. A book no rung can measure resolves to
/// NULL and so contributes to neither figure.
async fn page_total(pool: &SqlitePool) -> Result<MeasuredTotal, StatsError> {
    measured(
        pool,
        &format!(
            "SELECT COALESCE(SUM(p.pages), 0) AS total, COUNT(p.pages) AS books
             FROM ({}) p JOIN books b ON b.uuid = p.uuid WHERE {LIVE_BOOK}",
            pages::book_pages_source()
        ),
    )
    .await
}

/// Total seconds of audio, and the audiobooks behind it. Sums `book_file_parts`,
/// never `file_chapters` (synthetic filler would double-count); counts one *format*
/// per book (the lowest-ordinal audio file's, every volume of it); and counts a
/// book only when every part of every volume is measured.
async fn listening_total(pool: &SqlitePool) -> Result<MeasuredTotal, StatsError> {
    // `HAVING MIN(...) > 0`: `duration_seconds` is 0 until the indexer probes it, so a
    // half-probed book would otherwise count as measured at a fraction of its length.
    measured(
        pool,
        &format!(
            "SELECT COALESCE(SUM(d.secs), 0) AS total, COUNT(*) AS books
             FROM (
                 SELECT CAST(ROUND(SUM(p.duration_seconds)) AS INTEGER) AS secs
                 FROM book_files bf
                 JOIN book_file_parts p ON p.book_file_id = bf.id
                 JOIN books b ON b.id = bf.book_id
                 WHERE {LIVE_BOOK}
                   AND bf.format = (
                       SELECT bf2.format FROM book_files bf2
                       WHERE bf2.book_id = bf.book_id AND bf2.format IN {AUDIO_FORMATS}
                       ORDER BY bf2.ordinal LIMIT 1
                   )
                 GROUP BY bf.book_id
                 HAVING MIN(p.duration_seconds) > 0
             ) d"
        ),
    )
    .await
}

/// Run a `(total, books)` query. Every figure here has the same shape, so the
/// pair is read in one place — a total that drifted from its own denominator
/// is exactly the failure this type exists to prevent.
async fn measured(pool: &SqlitePool, sql: &str) -> Result<MeasuredTotal, StatsError> {
    let row = sqlx::query(sql).fetch_one(pool).await?;
    Ok(MeasuredTotal {
        total: row.get("total"),
        books: row.get("books"),
    })
}

#[cfg(test)]
mod tests;
