//! `attach_derived_percent` / `derive_epub_percent`: deriving a whole-book
//! percent from a stored CFI against the source EPUB on disk, and the cases
//! that decline to derive one — plus the reverse, `fill_derived_epub_cfi`,
//! which places a stored percent back onto the book as a CFI.

use omnibus_shared::ProgressUpdate;
use sqlx::SqlitePool;

use crate::init_db;

use super::super::*;
use super::{seed, seed_named_file, seed_user};

// ── derived-percent attachment (#1864) ──────────────────────────────

/// One-paragraph chapter used twice so the whole-book percent at the start
/// of chapter 2 is exactly 50 (identical visible-text counts per chapter).
const PERCENT_CHAPTER: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>C</title></head>
<body>
  <p>First sentence here. Second sentence follows.</p>
</body>
</html>"#;

/// Seed one book whose two-chapter EPUB really exists on disk in a per-test
/// library dir, plus a user; returns `(pool, user_id, book_uuid)`.
async fn seed_epub_on_disk(tag: &str) -> (SqlitePool, i64, String) {
    let dir = crate::test_support::make_test_dir(&format!("derive_percent_{tag}"));
    std::fs::write(
        dir.join("book.epub"),
        crate::test_support::build_test_epub(&[
            ("c1.xhtml", PERCENT_CHAPTER),
            ("c2.xhtml", PERCENT_CHAPTER),
        ]),
    )
    .unwrap();
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed_named_file(&pool, dir.to_str().unwrap(), "Book", "book.epub").await;
    let user = seed_user(&pool, "alice").await;
    (pool, user, uuid)
}

fn cfi_update(uuid: &str, cfi: &str, client_updated_at: i64) -> ProgressUpdate {
    ProgressUpdate {
        book_uuid: uuid.to_string(),
        format: ProgressFormat::Epub,
        epub_cfi: Some(cfi.to_string()),
        audio_position_seconds: None,
        progress_percent: None,
        kobo_location: None,
        book_file_id: None,
        client_updated_at: Some(client_updated_at),
    }
}

#[tokio::test]
async fn attach_derived_percent_sets_percent_only_when_clock_matches() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    let (_, uuid) = seed(&pool, "/lib", "Book A").await;
    let saved = upsert_progress(
        &pool,
        user,
        &cfi_update(&uuid, "epubcfi(/6/4!/4/2/1:0)", 1_000),
    )
    .await
    .unwrap();
    assert_eq!(saved.client_updated_at, 1_000);

    // Stale expectation: the row's event time is 1_000, not 999.
    let stale = attach_derived_percent(&pool, user, &uuid, 43, 999)
        .await
        .unwrap();
    assert!(!stale, "a mismatched clock must not attach");

    let attached = attach_derived_percent(&pool, user, &uuid, 43, 1_000)
        .await
        .unwrap();
    assert!(attached);
    let row = get_progress(&pool, user, &uuid, ProgressFormat::Epub)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.progress_percent, Some(43));
    // Clock-neutral: neither freshness clock moved.
    assert_eq!(row.client_updated_at, saved.client_updated_at);
    assert_eq!(row.updated_at, saved.updated_at);

    // A percent already present is never overwritten by a derivation.
    let second = attach_derived_percent(&pool, user, &uuid, 77, 1_000)
        .await
        .unwrap();
    assert!(!second);
    let row = get_progress(&pool, user, &uuid, ProgressFormat::Epub)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.progress_percent, Some(43));
}

#[tokio::test]
async fn derive_epub_percent_attaches_visible_text_percent_from_source_epub() {
    let (pool, user, uuid) = seed_epub_on_disk("happy").await;
    // Spine index 1 (`/6/4`), first text node, offset 0 — the first visible
    // character of chapter 2 of two identical chapters: exactly 50%.
    let cfi = "epubcfi(/6/4!/4/2/1:0)";
    let saved = upsert_progress(&pool, user, &cfi_update(&uuid, cfi, 1_000))
        .await
        .unwrap();
    assert_eq!(saved.progress_percent, None);

    let derived = derive_epub_percent(&pool, user, &uuid, cfi, saved.client_updated_at)
        .await
        .unwrap();
    assert!(derived);
    let row = get_progress(&pool, user, &uuid, ProgressFormat::Epub)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.progress_percent, Some(50));
    assert_eq!(row.client_updated_at, saved.client_updated_at);
}

#[tokio::test]
async fn derive_epub_percent_returns_false_when_book_has_no_epub_file() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    // A ghosted book: `books` row only, no `book_files` — the shape a
    // removed file leaves behind (F2).
    sqlx::query("INSERT INTO scan_roots (path, display_name) VALUES ('/lib2', 'lib2')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO books (uuid, scan_key, library_id, path, title, sort)
         SELECT 'ghost-uuid', 'g.epub', id, '/lib2/g', 'Ghost', 'ghost'
           FROM scan_roots WHERE path = '/lib2'",
    )
    .execute(&pool)
    .await
    .unwrap();

    let derived = derive_epub_percent(&pool, user, "ghost-uuid", "epubcfi(/6/2!/4/2/1:0)", 1_000)
        .await
        .unwrap();
    assert!(!derived, "a fileless book must degrade to no derivation");
}

#[tokio::test]
async fn derive_epub_percent_returns_false_for_an_unparseable_cfi() {
    let (pool, user, uuid) = seed_epub_on_disk("unparseable").await;
    // A comic-page anchor reuses the CFI slot but is not a CFI; the parse
    // refuses it and nothing attaches.
    let derived = derive_epub_percent(&pool, user, &uuid, "comic-page:3", 1_000)
        .await
        .unwrap();
    assert!(!derived);
}

#[tokio::test]
async fn derive_epub_percent_returns_false_for_a_pdf_page_anchor() {
    // The PDF reader writes its percent with every turn; there is no offset
    // to walk, so the derivation declines before touching the file.
    let (pool, user, uuid) = seed_epub_on_disk("pdf_anchor").await;
    let derived = derive_epub_percent(&pool, user, &uuid, "pdf-page:3", 1_000)
        .await
        .unwrap();
    assert!(!derived);
}

#[tokio::test]
async fn derive_epub_percent_agrees_with_stored_spine_stats() {
    // Same two-identical-chapter book as the full-walk test, but with the
    // 0071 structure extracted first: the stats fast-path must land the
    // same value (exactly 50 at the start of chapter 2), and the row's
    // clocks must stay untouched.
    let dir = crate::test_support::make_test_dir("derive_percent_stats");
    std::fs::write(
        dir.join("book.epub"),
        crate::test_support::build_test_epub(&[
            ("c1.xhtml", PERCENT_CHAPTER),
            ("c2.xhtml", PERCENT_CHAPTER),
        ]),
    )
    .unwrap();
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed_named_file(&pool, dir.to_str().unwrap(), "Book", "book.epub").await;
    let user = seed_user(&pool, "alice").await;
    crate::indexer::backfill_epub_structure(&pool, dir.to_str().unwrap(), |_, _, _| {})
        .await
        .unwrap();
    let file_id: i64 = sqlx::query_scalar("SELECT id FROM book_files LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        !crate::epub_structure::get_spine_stats(&pool, file_id)
            .await
            .unwrap()
            .is_empty(),
        "precondition: stats extracted so the fast path is the one exercised"
    );

    let cfi = "epubcfi(/6/4!/4/2/1:0)";
    let saved = upsert_progress(&pool, user, &cfi_update(&uuid, cfi, 1_000))
        .await
        .unwrap();
    let derived = derive_epub_percent(&pool, user, &uuid, cfi, saved.client_updated_at)
        .await
        .unwrap();
    assert!(derived);
    let row = get_progress(&pool, user, &uuid, ProgressFormat::Epub)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.progress_percent, Some(50));
    assert_eq!(row.client_updated_at, saved.client_updated_at);
    assert_eq!(row.updated_at, saved.updated_at);
}

// ── derived resume CFI for a percent-only row (#2446) ────────────────

/// [`seed_epub_on_disk`] with the spine stats extracted, which is what places
/// a percent: returns `(pool, user_id, book_uuid, epub_path)`.
async fn seed_measured_epub(tag: &str) -> (SqlitePool, i64, String, std::path::PathBuf) {
    let (pool, user, uuid) = seed_epub_on_disk(tag).await;
    let library: String = sqlx::query_scalar("SELECT path FROM scan_roots LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    crate::indexer::backfill_epub_structure(&pool, &library, |_, _, _| {})
        .await
        .unwrap();
    let epub = std::path::Path::new(&library).join("book.epub");
    (pool, user, uuid, epub)
}

fn percent_update(uuid: &str, percent: i64) -> ProgressUpdate {
    ProgressUpdate {
        book_uuid: uuid.to_string(),
        format: ProgressFormat::Epub,
        epub_cfi: None,
        audio_position_seconds: None,
        progress_percent: Some(percent),
        kobo_location: None,
        book_file_id: None,
        client_updated_at: Some(1_000),
    }
}

/// Where a CFI sits on the spine-stats ruler, as a whole-book fraction.
async fn fraction_of(pool: &SqlitePool, epub: &std::path::Path, cfi: &str) -> f64 {
    let file_id: i64 = sqlx::query_scalar("SELECT id FROM book_files LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap();
    let stats = crate::epub_structure::get_spine_stats(pool, file_id)
        .await
        .unwrap();
    let (spine_index, offset) = crate::kobo_position::cfi_spine_offset(epub, cfi)
        .unwrap()
        .expect("the derived CFI should walk back onto the book");
    crate::epub_structure::fraction_at(&stats, spine_index as i64, offset).unwrap()
}

#[tokio::test]
async fn fill_derived_epub_cfi_places_a_percent_only_row_at_or_before_its_percent() {
    // A Kobo's write: 42% and no CFI. The derived CFI must land on the same
    // ruler at 42% — never past it, which would open the reader ahead of
    // where they stopped (rule 11), and not a character further back than
    // the floor.
    let (pool, user, uuid, epub) = seed_measured_epub("fill_cfi").await;
    upsert_progress(&pool, user, &percent_update(&uuid, 42))
        .await
        .unwrap();
    let mut row = get_progress(&pool, user, &uuid, ProgressFormat::Epub)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        row.derived_epub_cfi, None,
        "the plain getter derives nothing"
    );

    fill_derived_epub_cfi(&pool, &mut row).await;

    let derived = row
        .derived_epub_cfi
        .expect("a measured book places its percent");
    let frac = fraction_of(&pool, &epub, &derived).await;
    assert!(frac <= 0.42, "derived {derived} sits at {frac}, past 42%");
    assert!(
        frac > 0.41,
        "derived {derived} sits at {frac}, a whole percent short"
    );
    // Response-only: the stored row still says exactly what the Kobo wrote.
    assert_eq!(row.epub_cfi, None);
    assert_eq!(row.progress_percent, Some(42));
}

#[tokio::test]
async fn fill_derived_epub_cfi_leaves_rows_that_need_no_placing_alone() {
    let (pool, user, uuid, _) = seed_measured_epub("fill_cfi_skip").await;
    // The row's own CFI is where it opens; a second one would only disagree.
    let saved = upsert_progress(
        &pool,
        user,
        &cfi_update(&uuid, "epubcfi(/6/4!/4/2/1:0)", 1_000),
    )
    .await
    .unwrap();
    let mut own = saved.clone();
    own.progress_percent = Some(50);
    fill_derived_epub_cfi(&pool, &mut own).await;
    assert_eq!(own.derived_epub_cfi, None);

    // 0% is the start, which is where an unplaced open lands anyway.
    let mut at_start = saved;
    at_start.epub_cfi = None;
    at_start.progress_percent = Some(0);
    fill_derived_epub_cfi(&pool, &mut at_start).await;
    assert_eq!(at_start.derived_epub_cfi, None);
}

#[tokio::test]
async fn fill_derived_epub_cfi_places_nothing_for_a_book_with_no_measured_structure() {
    // No spine stats yet: there is no ruler to place the percent on, and a
    // guess would be a confident wrong position.
    let (pool, user, uuid) = seed_epub_on_disk("fill_cfi_unmeasured").await;
    upsert_progress(&pool, user, &percent_update(&uuid, 42))
        .await
        .unwrap();
    let mut row = get_progress(&pool, user, &uuid, ProgressFormat::Epub)
        .await
        .unwrap()
        .unwrap();
    fill_derived_epub_cfi(&pool, &mut row).await;
    assert_eq!(row.derived_epub_cfi, None);
}

#[tokio::test]
async fn book_progress_carries_the_derived_cfi_for_a_percent_only_row() {
    // `GET /api/progress/{uuid}` — what the iOS and Android readers open on.
    let (pool, user, uuid, _) = seed_measured_epub("fill_cfi_read").await;
    upsert_progress(&pool, user, &percent_update(&uuid, 42))
        .await
        .unwrap();
    let progress = book_progress(&pool, user, &uuid, Some(ProgressFormat::Epub))
        .await
        .unwrap()
        .expect("book exists");
    let row = &progress.records[0];
    assert!(row
        .derived_epub_cfi
        .as_deref()
        .is_some_and(omnibus_shared::is_epub_cfi));
}
