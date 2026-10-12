//! Library composition: what the collection is made of, by format, language,
//! publisher, publication decade, and genre. Library-scoped like its `library`
//! sibling, so it carries its own single-entry cache. Every count is
//! `DISTINCT` over **books**, never rows — `book_files` is one row per file,
//! so a naive `COUNT(*)` reports a twelve-part audiobook as twelve.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use omnibus_shared::{CompositionDimension, CompositionSlice, LibraryComposition, MeasuredTotal};
use sqlx::{Row, SqlitePool};

use super::language::{language_label, UNKNOWN_LABEL};
use super::library::{live_book_count, LIVE_BOOK};
use super::StatsError;

/// How long a computed [`LibraryComposition`] is served from cache. Matches
/// `library`'s TTL for the same reason: a collection changes on a scan, not on
/// a sitting, and [`invalidate`] is what actually keeps this fresh.
const COMPOSITION_TTL_SECS: i64 = 900;

/// Real slices kept before the tail folds into [`OTHER_LABEL`]. Applied to the
/// open-ended dimensions only — a library can hold thousands of publishers,
/// and shipping every one of them to draw six bars is a payload nobody reads.
const SLICE_LIMIT: usize = 6;

/// Label of the synthetic tail slice. A real publisher or genre named "Other"
/// folds into it rather than colliding with it; the alternative is a legend
/// with two rows of the same name.
const OTHER_LABEL: &str = "Other";

/// The year at or below which a parsed `pubdate` means *unknown*, not
/// *ancient*. Calibre writes `UNDEFINED_DATE = datetime(101, 1, 1)` into OPF
/// as `0101-01-01`, and `CAST(substr(…, 1, 4) AS INTEGER)` yields 0 for an
/// absent or unparseable value — mirrors `frontend::format::SENTINEL_YEAR_MAX`
/// so a decade histogram and a rendered date agree on which books have one.
const SENTINEL_YEAR_MAX: i64 = 101;

/// Publication year, extracted with the **same** expression
/// `db::shelves::rules` uses for its `year` rule. Deliberately not a second
/// parse: a decade histogram and a `year >= 1990` smart shelf that disagreed
/// about a book would both look right in isolation.
const PUB_YEAR: &str = "CAST(substr(b.pubdate, 1, 4) AS INTEGER)";

/// One cache entry plus the generation it was computed against; the same
/// invalidate-race guard as `library`'s `Cache`.
#[derive(Default)]
struct Cache {
    entry: Mutex<Option<(i64, LibraryComposition)>>,
    generation: AtomicU64,
}

/// Process-wide cache. One entry, not a map: the answer is library-wide, so
/// there is nothing to key it on.
fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(Cache::default)
}

/// Drop the cached composition. Two callers: `Worker::execute` after a scan or
/// backfill, and every `metadata_overrides` write, which is not optional since
/// genre and publisher / language / `pubdate` overrides are not a `Task` the
/// worker would ever see.
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

/// What the library is made of, cached for [`COMPOSITION_TTL_SECS`].
pub async fn library_composition(pool: &SqlitePool) -> Result<LibraryComposition, StatsError> {
    library_composition_in(cache(), pool, super::now_secs()).await
}

/// Clock- and cache-injected core of [`library_composition`], so the cache path
/// is testable without waiting fifteen minutes. The cache is a parameter for the
/// same reason as `library`'s.
async fn library_composition_in(
    cache: &Cache,
    pool: &SqlitePool,
    now: i64,
) -> Result<LibraryComposition, StatsError> {
    if let Some(hit) = cache_get(cache, now) {
        return Ok(hit);
    }
    let generation = cache.generation.load(Ordering::SeqCst);
    let composition = compute(pool).await?;
    store_if_current(cache, generation, now, &composition);
    Ok(composition)
}

/// Publish a computed composition, unless an [`invalidate`] overtook the
/// compute. A compute that started before the bump describes the library as it
/// was before the scan — still the caller's own answer, but not one to hand
/// every other reader for the rest of the TTL.
fn store_if_current(cache: &Cache, generation: u64, now: i64, composition: &LibraryComposition) {
    if let Ok(mut guard) = cache.entry.lock() {
        if cache.generation.load(Ordering::SeqCst) == generation {
            *guard = Some((now, composition.clone()));
        }
    }
}

fn cache_get(cache: &Cache, now: i64) -> Option<LibraryComposition> {
    let guard = cache.entry.lock().ok()?;
    let (at, composition) = guard.as_ref()?;
    (now.saturating_sub(*at) < COMPOSITION_TTL_SECS).then(|| composition.clone())
}

/// Run every dimension and assemble the answer.
async fn compute(pool: &SqlitePool) -> Result<LibraryComposition, StatsError> {
    Ok(LibraryComposition {
        books: live_book_count(pool).await?,
        ghosted_books: ghosted_book_count(pool).await?,
        formats: formats(pool).await?,
        languages: languages(pool).await?,
        publishers: publishers(pool).await?,
        decades: decades(pool).await?,
        genres: genres(pool).await?,
    })
}

/// Books whose files are gone: a `books` row with no surviving `book_files`, the
/// population `admin_health::index_status` calls ghosted. Reported rather than
/// dropped, since a ghosted book has no format and per-format counts would
/// otherwise quietly fail to reconcile against the library.
async fn ghosted_book_count(pool: &SqlitePool) -> Result<i64, StatsError> {
    Ok(sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM books b WHERE NOT {LIVE_BOOK}"
    ))
    .fetch_one(pool)
    .await?)
}

/// Format mix by `book_files.format`. `COUNT(DISTINCT bf.book_id)`, never
/// `COUNT(*)` (a twelve-part M4B is twelve rows). A dual-format book is counted
/// **once in each bucket**, with no "Both" bucket; the overlap is disclosed as
/// `total - books` in the coverage pair. Not folded: the format vocabulary is
/// bounded by what the indexers write, and `UPPER` folds case drift.
async fn formats(pool: &SqlitePool) -> Result<CompositionDimension, StatsError> {
    let slices = read_slices(
        pool,
        "SELECT UPPER(bf.format) AS label, COUNT(DISTINCT bf.book_id) AS books
           FROM book_files bf
       GROUP BY UPPER(bf.format)
       ORDER BY books DESC, label ASC",
    )
    .await?;
    let coverage = read_coverage(
        pool,
        "SELECT COUNT(*) AS total, COUNT(DISTINCT p.book_id) AS books
           FROM (SELECT DISTINCT book_id, UPPER(format) AS format FROM book_files) p",
    )
    .await?;
    Ok(CompositionDimension { slices, coverage })
}

/// Language mix, tail folded into "Other" like every other open-ended dimension.
/// Reads `(book, code)` pairs because the fold is per **book**: a file spells one
/// language several ways (`en`, `en-US`, `eng`), and the fold happens in Rust
/// since the alias table is a Rust table. Books with no language link are
/// **uncovered**; one that declared `und` lands in [`UNKNOWN_LABEL`].
async fn languages(pool: &SqlitePool) -> Result<CompositionDimension, StatsError> {
    let rows = sqlx::query(&format!(
        "SELECT l.book AS book, e.code AS code
           FROM books_languages_link l
           JOIN languages e ON e.id = l.language
           JOIN books b ON b.id = l.book
          WHERE {LIVE_BOOK}"
    ))
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|r| (r.get::<i64, _>("book"), r.get::<String, _>("code")))
    .collect();
    let (slices, coverage) = fold_language_placements(rows);
    Ok(CompositionDimension {
        slices: fold_tail(slices),
        coverage,
    })
}

/// Re-bucket `(book, code)` rows under [`language_label`], counting each book **once
/// per bucket** however many of its codes fold into it (de-duplicated, not summed),
/// with the coverage pair over the same placements so slices sum to `coverage.total`.
/// Slices come back ordered count desc, label asc, [`UNKNOWN_LABEL`] sinking in a
/// tie, so [`fold_tail`] still splits a sorted list.
fn fold_language_placements(rows: Vec<(i64, String)>) -> (Vec<CompositionSlice>, MeasuredTotal) {
    let mut books: BTreeSet<i64> = BTreeSet::new();
    let mut placements: BTreeSet<(i64, String)> = BTreeSet::new();
    for (book, code) in rows {
        books.insert(book);
        placements.insert((book, language_label(&code)));
    }
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for (_, label) in &placements {
        *counts.entry(label.clone()).or_default() += 1;
    }
    let mut slices: Vec<CompositionSlice> = counts
        .into_iter()
        .map(|(label, books)| CompositionSlice { label, books })
        .collect();
    slices.sort_by(|a, b| {
        b.books.cmp(&a.books).then_with(|| {
            (a.label == UNKNOWN_LABEL)
                .cmp(&(b.label == UNKNOWN_LABEL))
                .then_with(|| a.label.cmp(&b.label))
        })
    });
    let coverage = MeasuredTotal {
        total: i64::try_from(placements.len()).unwrap_or(i64::MAX),
        books: i64::try_from(books.len()).unwrap_or(i64::MAX),
    };
    (slices, coverage)
}

/// Publisher spread by `publishers.name`, tail folded into "Other". One link row
/// is one placement (`PRIMARY KEY(book, publisher)`, `name` is `UNIQUE COLLATE
/// NOCASE`), so no de-duplication is needed; a book under two publishers is one
/// placement in each, disclosed by `coverage.total - coverage.books`.
async fn publishers(pool: &SqlitePool) -> Result<CompositionDimension, StatsError> {
    let slices = read_slices(
        pool,
        &format!(
            "SELECT e.name AS label, COUNT(DISTINCT l.book) AS books
               FROM books_publishers_link l
               JOIN publishers e ON e.id = l.publisher
               JOIN books b ON b.id = l.book
              WHERE {LIVE_BOOK}
           GROUP BY e.id
           ORDER BY books DESC, label ASC"
        ),
    )
    .await?;
    let coverage = read_coverage(
        pool,
        &format!(
            "SELECT COUNT(*) AS total, COUNT(DISTINCT l.book) AS books
               FROM books_publishers_link l
               JOIN books b ON b.id = l.book
              WHERE {LIVE_BOOK}"
        ),
    )
    .await?;
    Ok(CompositionDimension {
        slices: fold_tail(slices),
        coverage,
    })
}

/// Publication decades, oldest first, not folded and ordered by decade rather than
/// by count. A book whose `pubdate` is absent or unparseable is **unknown**, never
/// bucketed: anything at or below [`SENTINEL_YEAR_MAX`] (0 for absent, 101 for
/// Calibre's `0101`) is excluded and falls out of the coverage pair as uncovered.
async fn decades(pool: &SqlitePool) -> Result<CompositionDimension, StatsError> {
    let dated = format!("{LIVE_BOOK} AND {PUB_YEAR} > {SENTINEL_YEAR_MAX}");
    let rows = sqlx::query(&format!(
        "SELECT ({PUB_YEAR} / 10) * 10 AS decade, COUNT(*) AS books
           FROM books b
          WHERE {dated}
       GROUP BY decade
       ORDER BY decade ASC"
    ))
    .fetch_all(pool)
    .await?;
    let slices = rows
        .into_iter()
        .map(|r| {
            let decade: i64 = r.get("decade");
            CompositionSlice {
                label: format!("{decade}s"),
                books: r.get("books"),
            }
        })
        .collect();
    // Each book falls in exactly one decade, so the placement count and the
    // book count are the same number — the pair still travels, because it is
    // read against the library total to size the unknowns.
    let coverage = read_coverage(
        pool,
        &format!("SELECT COUNT(*) AS total, COUNT(*) AS books FROM books b WHERE {dated}"),
    )
    .await?;
    Ok(CompositionDimension { slices, coverage })
}

/// Genre distribution, tail folded into "Other". Genres have **no link table**:
/// a book's genres live only in `metadata_overrides -> '$.genres'`, so this
/// describes only hand-edited books and its coverage pair is essential. Joins
/// `genres` rather than grouping the raw JSON, as `genre::genre_share` does, so
/// "sci-fi" and "Sci-Fi" are one bucket.
async fn genres(pool: &SqlitePool) -> Result<CompositionDimension, StatsError> {
    let pairs = format!(
        "SELECT DISTINCT b.uuid AS uuid, g.id AS gid, g.name AS name
           FROM books b
           JOIN metadata_overrides mo ON mo.book_uuid = b.uuid
           JOIN json_each(mo.overrides, '$.genres') je
           JOIN genres g ON g.name = je.value COLLATE NOCASE
          WHERE {LIVE_BOOK} AND json_type(mo.overrides, '$.genres') IS NOT NULL"
    );
    let slices = read_slices(
        pool,
        &format!(
            "SELECT p.name AS label, COUNT(*) AS books FROM ({pairs}) p
           GROUP BY p.gid ORDER BY books DESC, label ASC"
        ),
    )
    .await?;
    let coverage = read_coverage(
        pool,
        &format!("SELECT COUNT(*) AS total, COUNT(DISTINCT p.uuid) AS books FROM ({pairs}) p"),
    )
    .await?;
    Ok(CompositionDimension {
        slices: fold_tail(slices),
        coverage,
    })
}

/// Keep the top [`SLICE_LIMIT`] slices and fold the rest into one "Other" row;
/// the input is already ordered by count. The coverage pair is untouched, so the
/// folded slices still sum to `coverage.total`. A kept slice itself named "Other"
/// absorbs the tail, since a duplicate label breaks iOS's `Identifiable` `ForEach`.
fn fold_tail(mut slices: Vec<CompositionSlice>) -> Vec<CompositionSlice> {
    if slices.len() <= SLICE_LIMIT {
        return slices;
    }
    let rest: i64 = slices.split_off(SLICE_LIMIT).iter().map(|s| s.books).sum();
    if rest == 0 {
        return slices;
    }
    match slices.iter_mut().find(|s| s.label == OTHER_LABEL) {
        Some(existing) => existing.books += rest,
        None => slices.push(CompositionSlice {
            label: OTHER_LABEL.to_string(),
            books: rest,
        }),
    }
    slices
}

/// Run a `(label, books)` query into slices.
async fn read_slices(pool: &SqlitePool, sql: &str) -> Result<Vec<CompositionSlice>, StatsError> {
    Ok(sqlx::query(sql)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| CompositionSlice {
            label: r.get("label"),
            books: r.get("books"),
        })
        .collect())
}

/// Run a `(total, books)` coverage query. Every dimension reads its pair the
/// same way — a placement count that drifted from its own book count is
/// exactly what the pair exists to make visible.
async fn read_coverage(pool: &SqlitePool, sql: &str) -> Result<MeasuredTotal, StatsError> {
    let row = sqlx::query(sql).fetch_one(pool).await?;
    Ok(MeasuredTotal {
        total: row.get("total"),
        books: row.get("books"),
    })
}

#[cfg(test)]
mod tests;
