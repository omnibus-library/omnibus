//! Tests for the `series_sort` write-time helper and boot backfill.

use omnibus_shared::EbookMetadata;

use super::*;
use crate::pool::init_db;
use crate::sync::replace_books;
use crate::test_support::indexed;

fn with_series(series: Option<&str>) -> EbookMetadata {
    EbookMetadata {
        series: series.map(Into::into),
        ..Default::default()
    }
}

#[test]
fn series_sort_value_returns_primary_series_name() {
    assert_eq!(
        series_sort_value(&with_series(Some("Foundation"))),
        Some("Foundation".to_string())
    );
}

#[test]
fn series_sort_value_returns_none_when_no_series() {
    assert_eq!(series_sort_value(&with_series(None)), None);
}

#[test]
fn series_sort_value_trims_and_drops_empty() {
    assert_eq!(
        series_sort_value(&with_series(Some("  Saga  "))),
        Some("Saga".to_string())
    );
    assert_eq!(series_sort_value(&with_series(Some("   "))), None);
}

#[tokio::test]
async fn indexing_keeps_series_sort_and_series_link_trimmed_in_lockstep() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    // A whitespace-padded series name from a messy source.
    replace_books(
        &pool,
        "/lib",
        vec![indexed(
            "a.epub",
            Some("A"),
            &["Auth"],
            &[],
            Some(("  Saga  ", "1")),
            None,
        )],
    )
    .await
    .unwrap();

    // The denormalized sort key is trimmed...
    let series_sort: Option<String> = sqlx::query_scalar("SELECT series_sort FROM books LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(series_sort.as_deref(), Some("Saga"));
    // ...and the linked series row is trimmed to match — no whitespace drift.
    let name: String = sqlx::query_scalar("SELECT name FROM series LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name, "Saga");
}

#[tokio::test]
async fn backfill_series_sort_fills_linked_books_and_skips_seriesless() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib_id: i64 = sqlx::query_scalar(
        "INSERT INTO scan_roots (path, display_name) VALUES ('/lib', 'l') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let series_id: i64 =
        sqlx::query_scalar("INSERT INTO series (name, sort) VALUES ('Dune', 'Dune') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    // A linked book with series_sort still NULL (the pre-0028 state).
    let linked: i64 = sqlx::query_scalar(
        "INSERT INTO books (uuid, library_id, path, title, series_sort) VALUES ('a', ?, '/lib', 'A', NULL) RETURNING id",
    )
    .bind(lib_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO books_series_link (book, series) VALUES (?, ?)")
        .bind(linked)
        .bind(series_id)
        .execute(&pool)
        .await
        .unwrap();
    // A seriesless book — must stay NULL and never be re-touched.
    let seriesless: i64 = sqlx::query_scalar(
        "INSERT INTO books (uuid, library_id, path, title, series_sort) VALUES ('b', ?, '/lib', 'B', NULL) RETURNING id",
    )
    .bind(lib_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    backfill_series_sort(&pool).await.unwrap();

    let linked_sort: Option<String> =
        sqlx::query_scalar("SELECT series_sort FROM books WHERE id = ?")
            .bind(linked)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(linked_sort.as_deref(), Some("Dune"));

    let seriesless_sort: Option<String> =
        sqlx::query_scalar("SELECT series_sort FROM books WHERE id = ?")
            .bind(seriesless)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(seriesless_sort, None);

    // Idempotent: a second pass is a no-op and leaves values intact.
    backfill_series_sort(&pool).await.unwrap();
    let again: Option<String> = sqlx::query_scalar("SELECT series_sort FROM books WHERE id = ?")
        .bind(linked)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(again.as_deref(), Some("Dune"));
}

#[tokio::test]
async fn backfill_series_sort_propagates_db_error_when_pool_is_closed() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;
    let err = backfill_series_sort(&pool).await.unwrap_err();
    assert!(matches!(err, SortKeysError::Db(_)));
}

async fn seed_book_with_author_sort(pool: &sqlx::SqlitePool, uuid: &str, stored: &str) -> i64 {
    sqlx::query("INSERT OR IGNORE INTO scan_roots (path, display_name) VALUES ('/lib', 'lib')")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query_scalar(
        "INSERT INTO books (uuid, library_id, path, title, author_sort) \
         VALUES (?, 1, '', 't', ?) RETURNING id",
    )
    .bind(uuid)
    .bind(stored)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn link_author(
    pool: &sqlx::SqlitePool,
    book: i64,
    name: &str,
    sort: Option<&str>,
    position: i64,
) {
    let author: i64 = sqlx::query_scalar(
        "INSERT INTO authors (name, sort) VALUES (?, ?) \
         ON CONFLICT(name) DO UPDATE SET name = name RETURNING id",
    )
    .bind(name)
    .bind(sort)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO books_authors_link (book, author, position) VALUES (?, ?, ?)")
        .bind(book)
        .bind(author)
        .bind(position)
        .execute(pool)
        .await
        .unwrap();
}

async fn stored_author_sort(pool: &sqlx::SqlitePool, book: i64) -> String {
    sqlx::query_scalar("SELECT author_sort FROM books WHERE id = ?")
        .bind(book)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn refresh_author_sort_keys_the_lowest_position_author_even_with_a_gap() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let book = seed_book_with_author_sort(&pool, "u1", "Steven, Laura").await;
    link_author(&pool, book, "Laura Steven", None, 5).await;
    link_author(
        &pool,
        book,
        "Benito Pérez Galdós",
        Some("Pérez Galdós, Benito"),
        2,
    )
    .await;

    let mut conn = pool.acquire().await.unwrap();
    refresh_author_sort(&mut conn, &[book]).await.unwrap();

    assert_eq!(
        stored_author_sort(&pool, book).await,
        "Pérez Galdós, Benito"
    );
}

#[tokio::test]
async fn refresh_author_sort_derives_the_key_from_the_name_when_the_author_has_no_sort() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let book = seed_book_with_author_sort(&pool, "u1", "stale").await;
    link_author(&pool, book, "Brandon Sanderson", None, 0).await;

    let mut conn = pool.acquire().await.unwrap();
    refresh_author_sort(&mut conn, &[book]).await.unwrap();

    assert_eq!(stored_author_sort(&pool, book).await, "Sanderson, Brandon");
}

#[tokio::test]
async fn refresh_author_sort_leaves_a_book_with_no_author_links_alone() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let book = seed_book_with_author_sort(&pool, "u1", "Keep, Me").await;

    let mut conn = pool.acquire().await.unwrap();
    refresh_author_sort(&mut conn, &[book]).await.unwrap();

    assert_eq!(stored_author_sort(&pool, book).await, "Keep, Me");
}
