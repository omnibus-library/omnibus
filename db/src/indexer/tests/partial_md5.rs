//! The partial-MD5 backfill: fills only NULL original ebook rows, leaves what it
//! cannot read for the next scan, and is a no-op once caught up.

use crate::pool::init_db;
use crate::test_support::make_test_dir;

use super::super::*;

/// Seed a one-file book under `dir` with a NULL `partial_md5`; the file is the
/// fixture `fixture_name` copied in unless `on_disk` is false. Returns the file row id.
async fn seed_file(
    pool: &SqlitePool,
    dir: &std::path::Path,
    fixture_name: &str,
    format: &str,
    on_disk: bool,
) -> i64 {
    if on_disk {
        crate::ebook::test_support::copy_fixture_into(fixture_name, dir);
    }
    let root = dir.to_str().unwrap();
    sqlx::query(
        "INSERT INTO scan_roots (path, display_name) VALUES (?, ?) ON CONFLICT(path) DO NOTHING",
    )
    .bind(root)
    .bind(root)
    .execute(pool)
    .await
    .unwrap();
    let lib_id: i64 = sqlx::query_scalar("SELECT id FROM scan_roots WHERE path = ?")
        .bind(root)
        .fetch_one(pool)
        .await
        .unwrap();
    let book_id: i64 = sqlx::query_scalar(
        "INSERT INTO books (uuid, library_id, path, title) VALUES (?, ?, '', ?) RETURNING id",
    )
    .bind(fixture_name)
    .bind(lib_id)
    .bind(fixture_name)
    .fetch_one(pool)
    .await
    .unwrap();
    let stem = fixture_name.split('.').next().unwrap();
    sqlx::query_scalar(
        "INSERT INTO book_files (book_id, format, filename, size_bytes) \
         VALUES (?, ?, ?, 0) RETURNING id",
    )
    .bind(book_id)
    .bind(format)
    .bind(stem)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn digest_of(pool: &SqlitePool, file_id: i64) -> Option<String> {
    sqlx::query_scalar("SELECT partial_md5 FROM book_files WHERE id = ?")
        .bind(file_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

// Literals are `dd` + `md5sum` over the samples KOReader reads, not this module's output.
#[tokio::test]
async fn backfill_partial_md5_fills_null_ebook_rows() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let dir = make_test_dir("pmd5-fill");
    let alpha = seed_file(&pool, &dir, "alpha.epub", "EPUB", true).await;
    let beta = seed_file(&pool, &dir, "beta.epub", "EPUB", true).await;

    let mut progress: Vec<(u32, u32)> = Vec::new();
    backfill_partial_md5(&pool, dir.to_str().unwrap(), |p, t, _| {
        progress.push((p, t))
    })
    .await
    .unwrap();

    assert_eq!(
        digest_of(&pool, alpha).await.as_deref(),
        Some("279e27fb695d12d161736300a93e255d")
    );
    assert_eq!(
        digest_of(&pool, beta).await.as_deref(),
        Some("1c5b406d56a098b1c6e4f10cfc137125")
    );
    assert_eq!(progress, vec![(1, 2), (2, 2)]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn backfill_partial_md5_skips_rows_that_are_not_epubs() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let dir = make_test_dir("pmd5-skip");
    let audio = seed_file(&pool, &dir, "alpha.epub", "M4B", true).await;

    let mut calls = 0u32;
    backfill_partial_md5(&pool, dir.to_str().unwrap(), |_, _, _| calls += 1)
        .await
        .unwrap();

    assert_eq!(digest_of(&pool, audio).await, None);
    assert_eq!(calls, 0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn backfill_partial_md5_is_a_noop_once_filled() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let dir = make_test_dir("pmd5-idempotent");
    seed_file(&pool, &dir, "alpha.epub", "EPUB", true).await;
    backfill_partial_md5(&pool, dir.to_str().unwrap(), |_, _, _| {})
        .await
        .unwrap();

    let mut calls = 0u32;
    backfill_partial_md5(&pool, dir.to_str().unwrap(), |_, _, _| calls += 1)
        .await
        .unwrap();

    assert_eq!(calls, 0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn backfill_partial_md5_leaves_an_unreadable_file_null() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let dir = make_test_dir("pmd5-unreadable");
    let missing = seed_file(&pool, &dir, "alpha.epub", "EPUB", false).await;
    let present = seed_file(&pool, &dir, "beta.epub", "EPUB", true).await;

    backfill_partial_md5(&pool, dir.to_str().unwrap(), |_, _, _| {})
        .await
        .unwrap();

    assert_eq!(digest_of(&pool, missing).await, None);
    assert!(digest_of(&pool, present).await.is_some());
    let _ = std::fs::remove_dir_all(&dir);
}
