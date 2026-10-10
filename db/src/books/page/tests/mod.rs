//! Keyset pagination tests for `list_books_page`, split by sub-topic into
//! the sibling modules below; the library, book, override and
//! physical-copy insert fixtures they share live here.

mod clauses;
mod dictionary;
mod filters;
mod overrides;
mod paging;
mod projection;
mod shelf_clauses;
mod stacked;

use std::sync::atomic::{AtomicU64, Ordering};

use omnibus_shared::{FilterClause, FilterField, FilterMode};
use sqlx::SqlitePool;

use super::*;

/// Unique uuid/scan_key per inserted row.
fn uniq() -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    format!("uuid-{}", N.fetch_add(1, Ordering::Relaxed))
}

async fn insert_lib(pool: &SqlitePool, path: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO scan_roots (path, display_name) VALUES (?, 'lib') RETURNING id")
        .bind(path)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Insert a book with an explicit `(title, sort, series_sort, series_index)`
/// plus a backing `book_files` row (so the fileless filter keeps it). Returns the
/// new book id.
async fn insert_book(
    pool: &SqlitePool,
    lib_id: i64,
    title: &str,
    sort: Option<&str>,
    series_sort: Option<&str>,
    series_index: Option<f64>,
) -> i64 {
    let key = uniq();
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO books (uuid, scan_key, library_id, path, title, sort, series_sort, series_index)
         VALUES (?, ?, ?, '/p', ?, ?, ?, ?) RETURNING id",
    )
    .bind(&key)
    .bind(&key)
    .bind(lib_id)
    .bind(title)
    .bind(sort)
    .bind(series_sort)
    .bind(series_index)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO book_files (book_id, format, filename, size_bytes, mtime_epoch)
         VALUES (?, 'EPUB', ?, 1, 1)",
    )
    .bind(id)
    .bind(title)
    .execute(pool)
    .await
    .unwrap();
    id
}

fn ids(page: &BookPage) -> Vec<i64> {
    page.books.iter().map(|b| b.id).collect()
}

fn titles(page: &BookPage) -> Vec<String> {
    page.books
        .iter()
        .map(|b| b.title.clone().unwrap_or_default())
        .collect()
}

fn sorted_titles(page: &BookPage) -> Vec<String> {
    let mut found = titles(page);
    found.sort();
    found
}

fn clause(field: FilterField, mode: FilterMode, values: &[&str]) -> FilterClause {
    FilterClause {
        field,
        mode,
        values: values.iter().map(|v| (*v).to_string()).collect(),
    }
}

async fn uuid_of(pool: &SqlitePool, id: i64) -> String {
    sqlx::query_scalar("SELECT uuid FROM books WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Write a raw `metadata_overrides` row for `book_id`.
async fn set_overrides_json(pool: &SqlitePool, book_id: i64, json: &str) {
    let uuid = uuid_of(pool, book_id).await;
    sqlx::query("INSERT INTO metadata_overrides (book_uuid, overrides) VALUES (?, ?)")
        .bind(uuid)
        .bind(json)
        .execute(pool)
        .await
        .unwrap();
}

/// Like [`insert_book`], but with an explicit set of `book_files` formats
/// (stored-case, e.g. `"CBZ"`). An empty slice inserts no file rows — pair it
/// with [`insert_physical_copy`] or the fileless gate hides the book.
async fn insert_book_with_formats(
    pool: &SqlitePool,
    lib_id: i64,
    title: &str,
    formats: &[&str],
) -> i64 {
    let key = uniq();
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO books (uuid, scan_key, library_id, path, title)
         VALUES (?, ?, ?, '/p', ?) RETURNING id",
    )
    .bind(&key)
    .bind(&key)
    .bind(lib_id)
    .bind(title)
    .fetch_one(pool)
    .await
    .unwrap();
    for (i, fmt) in formats.iter().enumerate() {
        sqlx::query(
            "INSERT INTO book_files (book_id, format, filename, size_bytes, mtime_epoch, ordinal)
             VALUES (?, ?, ?, 1, 1, ?)",
        )
        .bind(id)
        .bind(fmt)
        .bind(format!("{title}.{}", fmt.to_lowercase()))
        .bind(i as i64)
        .execute(pool)
        .await
        .unwrap();
    }
    id
}

/// Attach a physical copy to a book so the physical OR-arm keeps it visible.
async fn insert_physical_copy(pool: &SqlitePool, book_id: i64) {
    let uuid: String = sqlx::query_scalar("SELECT uuid FROM books WHERE id = ?")
        .bind(book_id)
        .fetch_one(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO physical_copies (book_uuid) VALUES (?)")
        .bind(uuid)
        .execute(pool)
        .await
        .unwrap();
}
