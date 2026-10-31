//! Per-user physical wishlist: add (idempotent), remove (and the purge of a
//! book only wanted, journal images included), the per-user scoped list and
//! its hard response cap, and the single-entry lookup.

use omnibus_shared::physical::{WishlistBook, WishlistSource};
use sqlx::SqlitePool;

use crate::test_support::{seed_minimal_books, CoversTempDir};

use super::super::*;
use super::{count, image_env, pool, seed_review_image, seed_user};

#[tokio::test]
async fn add_wishlist_entry_returns_the_entry() {
    let pool = pool().await;
    seed_minimal_books(&pool, 1).await;
    let user = seed_user(&pool, "reader").await;

    let entry = add_wishlist_entry(&pool, user, "uuid-1", WishlistSource::Scan)
        .await
        .unwrap();

    assert_eq!(entry.user_id, user);
    assert_eq!(entry.book_uuid, "uuid-1");
    assert_eq!(entry.source, WishlistSource::Scan);
}

/// Migration 0085 widened the `source` CHECK to admit the title-search door
/// (#2247); without it this insert fails the constraint outright.
#[tokio::test]
async fn add_wishlist_entry_accepts_the_title_search_source() {
    let pool = pool().await;
    seed_minimal_books(&pool, 1).await;
    let user = seed_user(&pool, "reader").await;

    let entry = add_wishlist_entry(&pool, user, "uuid-1", WishlistSource::Search)
        .await
        .unwrap();

    assert_eq!(entry.source, WishlistSource::Search);
    assert_eq!(
        get_wishlist_entry(&pool, user, "uuid-1")
            .await
            .unwrap()
            .map(|e| e.source),
        Some(WishlistSource::Search)
    );
}

#[tokio::test]
async fn add_wishlist_entry_errors_when_book_missing() {
    let pool = pool().await;
    let user = seed_user(&pool, "reader").await;
    let err = add_wishlist_entry(&pool, user, "nope", WishlistSource::Scan)
        .await
        .unwrap_err();
    assert!(matches!(err, PhysicalError::BookNotFound));
}

#[tokio::test]
async fn add_wishlist_entry_is_idempotent() {
    let pool = pool().await;
    seed_minimal_books(&pool, 1).await;
    let user = seed_user(&pool, "reader").await;

    let first = add_wishlist_entry(&pool, user, "uuid-1", WishlistSource::Scan)
        .await
        .unwrap();
    // A second add keeps the original row (same id, original source).
    let second = add_wishlist_entry(&pool, user, "uuid-1", WishlistSource::Manual)
        .await
        .unwrap();

    assert_eq!(first.id, second.id);
    assert_eq!(second.source, WishlistSource::Scan);
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM wishlist_entries").await,
        1
    );
}

#[tokio::test]
async fn remove_wishlist_entry_deletes_and_is_a_noop_when_absent() {
    let pool = pool().await;
    seed_minimal_books(&pool, 1).await;
    let user = seed_user(&pool, "reader").await;
    add_wishlist_entry(&pool, user, "uuid-1", WishlistSource::Detail)
        .await
        .unwrap();

    remove_wishlist_entry(&pool, user, "uuid-1").await.unwrap();
    assert!(list_wishlist(&pool, user).await.unwrap().is_empty());

    // Removing again is not an error.
    remove_wishlist_entry(&pool, user, "uuid-1").await.unwrap();
}

/// Raw bulk insert bypassing `add_wishlist_entry` — the CRUD helper resolves
/// the book uuid on every call, too slow for a 1500-row response-cap
/// fixture. `wishlist_entries` uniques on `(user_id, book_uuid)`, so each
/// row needs a distinct synthetic uuid; the soft-reference (no FK) means
/// these need not resolve to real `books` rows for this query-shape test.
async fn seed_wishlist_raw(pool: &SqlitePool, user_id: i64, count: i64) {
    sqlx::query(
        r"
        WITH RECURSIVE n(i) AS (
            SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?
        )
        INSERT INTO wishlist_entries (user_id, book_uuid, added_at, source)
        SELECT ?, 'seed-uuid-' || i, i, 'manual' FROM n
        ",
    )
    .bind(count)
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn list_wishlist_caps_response_at_hard_limit() {
    let pool = pool().await;
    let user = seed_user(&pool, "alice").await;
    let over_cap = LIST_WISHLIST_LIMIT + 500;
    seed_wishlist_raw(&pool, user, over_cap).await;

    let list = list_wishlist(&pool, user).await.unwrap();
    assert_eq!(
        list.len() as i64,
        LIST_WISHLIST_LIMIT,
        "list_wishlist must not return more than LIST_WISHLIST_LIMIT rows",
    );
}

#[tokio::test]
async fn list_wishlist_is_scoped_per_user() {
    let pool = pool().await;
    seed_minimal_books(&pool, 2).await;
    let alice = seed_user(&pool, "alice").await;
    let bob = seed_user(&pool, "bob").await;
    add_wishlist_entry(&pool, alice, "uuid-1", WishlistSource::Scan)
        .await
        .unwrap();
    add_wishlist_entry(&pool, bob, "uuid-2", WishlistSource::Scan)
        .await
        .unwrap();

    let alice_list = list_wishlist(&pool, alice).await.unwrap();
    assert_eq!(alice_list.len(), 1);
    assert_eq!(alice_list[0].book_uuid, "uuid-1");
}

// --- wishlist lookup -------------------------------------------------------

#[tokio::test]
async fn get_wishlist_entry_returns_the_entry_when_wishlisted() {
    let pool = pool().await;
    seed_minimal_books(&pool, 1).await;
    let user = seed_user(&pool, "reader").await;
    add_wishlist_entry(&pool, user, "uuid-1", WishlistSource::Detail)
        .await
        .unwrap();

    let entry = get_wishlist_entry(&pool, user, "uuid-1").await.unwrap();

    let entry = entry.expect("wishlisted book must return its entry");
    assert_eq!(entry.book_uuid, "uuid-1");
    assert_eq!(entry.source, WishlistSource::Detail);
}

#[tokio::test]
async fn get_wishlist_entry_returns_none_when_not_wishlisted() {
    let pool = pool().await;
    seed_minimal_books(&pool, 1).await;
    let user = seed_user(&pool, "reader").await;

    assert!(get_wishlist_entry(&pool, user, "uuid-1")
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn get_wishlist_entry_is_scoped_to_the_asking_user() {
    let pool = pool().await;
    seed_minimal_books(&pool, 1).await;
    let alice = seed_user(&pool, "alice").await;
    let bob = seed_user(&pool, "bob").await;
    add_wishlist_entry(&pool, alice, "uuid-1", WishlistSource::Detail)
        .await
        .unwrap();

    assert!(get_wishlist_entry(&pool, bob, "uuid-1")
        .await
        .unwrap()
        .is_none());
}

/// A wishlist-only book, minted the way a wishlist add mints one.
async fn seed_wished(pool: &SqlitePool, user: i64, title: &str) -> String {
    let uuid = create_fileless_book(
        pool,
        FilelessBook {
            title: title.into(),
            authors: vec!["Ada Lovelace".into()],
            isbn: None,
            pubdate: None,
            description: None,
            cover: None,
        },
    )
    .await
    .unwrap();
    add_wishlist_entry(pool, user, &uuid, WishlistSource::Search)
        .await
        .unwrap();
    uuid
}

#[tokio::test]
async fn remove_wishlist_entry_purges_a_book_that_existed_only_to_be_wanted() {
    let _covers = CoversTempDir::new("wishlist_purge");
    let pool = pool().await;
    let user = seed_user(&pool, "reader").await;
    let uuid = seed_wished(&pool, user, "Wanted").await;

    let removal = remove_wishlist_entry(&pool, user, &uuid).await.unwrap();

    assert!(removal.book_deleted);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM books").await, 0);
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM wishlist_entries").await,
        0
    );
}

#[tokio::test]
async fn remove_wishlist_entry_sweeps_the_journal_images_of_a_book_it_purges() {
    let tmp = tempfile::tempdir().unwrap();
    let _env = image_env(tmp.path());
    let pool = pool().await;
    let user = seed_user(&pool, "reader").await;
    let uuid = seed_wished(&pool, user, "Wanted").await;
    let name = seed_review_image(&pool, user, &uuid).await;

    let removal = remove_wishlist_entry(&pool, user, &uuid).await.unwrap();

    assert!(removal.book_deleted);
    assert!(!crate::journal_images::journal_images_dir()
        .join(&name)
        .exists());
}

#[tokio::test]
async fn remove_wishlist_entry_keeps_a_book_another_reader_still_wants() {
    let pool = pool().await;
    let user = seed_user(&pool, "reader").await;
    let other = seed_user(&pool, "other").await;
    let uuid = seed_wished(&pool, user, "Wanted").await;
    add_wishlist_entry(&pool, other, &uuid, WishlistSource::Detail)
        .await
        .unwrap();

    let removal = remove_wishlist_entry(&pool, user, &uuid).await.unwrap();

    assert!(!removal.book_deleted);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM books").await, 1);
    assert!(get_wishlist_entry(&pool, other, &uuid)
        .await
        .unwrap()
        .is_some());
}

#[tokio::test]
async fn remove_wishlist_entry_keeps_a_ghosted_library_book() {
    // No file, but a real scan root: the reindex owns that row and its
    // retention, and a reader unwishing it must not delete it out from under.
    let pool = pool().await;
    seed_minimal_books(&pool, 1).await;
    let user = seed_user(&pool, "reader").await;
    add_wishlist_entry(&pool, user, "uuid-1", WishlistSource::Detail)
        .await
        .unwrap();

    let removal = remove_wishlist_entry(&pool, user, "uuid-1").await.unwrap();

    assert!(!removal.book_deleted);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM books").await, 1);
}

// --- household wishlist reads ----------------------------------------------

/// A wishlist row with an explicit `added_at`, so the newest-first order is
/// pinned by the test and not by the clock.
async fn want_at(pool: &SqlitePool, user: i64, uuid: &str, added_at: i64) {
    sqlx::query(
        "INSERT INTO wishlist_entries (user_id, book_uuid, added_at, source)
         VALUES (?1, ?2, ?3, 'manual')",
    )
    .bind(user)
    .bind(uuid)
    .bind(added_at)
    .execute(pool)
    .await
    .unwrap();
}

/// Add one more digital file of `format` to the seeded book `uuid`.
async fn add_file(pool: &SqlitePool, uuid: &str, format: &str, ordinal: i64, path: &str) {
    sqlx::query(
        "INSERT INTO book_files (book_id, format, filename, size_bytes, mtime_epoch, ordinal, path)
         SELECT id, ?2, 'f', 1, 1, ?3, ?4 FROM books WHERE uuid = ?1",
    )
    .bind(uuid)
    .bind(format)
    .bind(ordinal)
    .bind(path)
    .execute(pool)
    .await
    .unwrap();
}

/// A physical copy row written directly: `add_physical_copy` would fulfil, and
/// so delete, the very wishlist entries these reads are looking at.
async fn add_copy_row(pool: &SqlitePool, uuid: &str) {
    sqlx::query("INSERT INTO physical_copies (book_uuid) VALUES (?1)")
        .bind(uuid)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn wishlist_readers_lists_every_user_caller_first_with_counts() {
    let pool = pool().await;
    seed_minimal_books(&pool, 2).await;
    let zed = seed_user(&pool, "zed").await;
    let alice = seed_user(&pool, "alice").await;
    let bob = seed_user(&pool, "bob").await;
    sqlx::query("UPDATE users SET share_stats = 0 WHERE id = ?1")
        .bind(bob)
        .execute(&pool)
        .await
        .unwrap();
    want_at(&pool, zed, "uuid-1", 1).await;
    want_at(&pool, alice, "uuid-1", 2).await;
    want_at(&pool, alice, "uuid-2", 3).await;
    // An entry whose book is gone is in neither the count nor the list.
    want_at(&pool, alice, "no-such-book", 4).await;

    let readers = wishlist_readers(&pool, zed).await.unwrap();

    let rows: Vec<(&str, i64, bool)> = readers
        .readers
        .iter()
        .map(|r| (r.name.as_str(), r.count, r.is_you))
        .collect();
    assert_eq!(
        rows,
        vec![("zed", 1, true), ("alice", 2, false), ("bob", 0, false)]
    );
}

#[tokio::test]
async fn wishlist_readers_counts_everyone_as_distinct_books() {
    let pool = pool().await;
    seed_minimal_books(&pool, 3).await;
    let alice = seed_user(&pool, "alice").await;
    let bob = seed_user(&pool, "bob").await;
    want_at(&pool, alice, "uuid-1", 1).await;
    want_at(&pool, bob, "uuid-1", 2).await;
    want_at(&pool, bob, "uuid-2", 3).await;

    let readers = wishlist_readers(&pool, alice).await.unwrap();

    assert_eq!(readers.everyone, 2);
}

#[tokio::test]
async fn wishlist_books_returns_a_readers_books_newest_first_with_holdings() {
    let _covers = CoversTempDir::new("wishlist_books_reader");
    let pool = pool().await;
    seed_minimal_books(&pool, 3).await;
    let alice = seed_user(&pool, "alice").await;
    let bob = seed_user(&pool, "bob").await;
    want_at(&pool, alice, "uuid-1", 100).await;
    want_at(&pool, alice, "uuid-3", 200).await;
    want_at(&pool, alice, "uuid-2", 300).await;
    want_at(&pool, bob, "uuid-1", 400).await;
    // Two editions of the audiobook, each in a folder of its own.
    add_file(&pool, "uuid-1", "M4B", 0, "a/one/book.m4b").await;
    add_file(&pool, "uuid-1", "m4b", 1, "b/one/book.m4b").await;
    add_copy_row(&pool, "uuid-1").await;
    let wanted = seed_wished(&pool, alice, "Wanted").await;

    let books = wishlist_books(&pool, WishlistScope::Reader(alice))
        .await
        .unwrap();

    let uuids: Vec<&str> = books
        .iter()
        .map(|b| b.book.unique_identifier.as_deref().unwrap())
        .collect();
    assert_eq!(uuids, vec![wanted.as_str(), "uuid-2", "uuid-3", "uuid-1"]);
    let holdings = |book: &WishlistBook| -> Vec<(String, i64)> {
        book.holdings
            .iter()
            .map(|h| (h.format.clone(), h.count))
            .collect()
    };
    assert_eq!(holdings(&books[0]), Vec::<(String, i64)>::new());
    assert_eq!(holdings(&books[1]), vec![("EPUB".to_string(), 1)]);
    assert_eq!(
        holdings(&books[3]),
        vec![
            ("EPUB".to_string(), 1),
            ("M4B".to_string(), 2),
            ("PRINT".to_string(), 1)
        ]
    );
    let wanters: Vec<&str> = books[3].wanted_by.iter().map(|w| w.name.as_str()).collect();
    assert_eq!(wanters, vec!["alice"]);
    assert_eq!(books[3].added_at, 100);
}

#[tokio::test]
async fn wishlist_books_merges_everyone_into_one_row_per_book_with_every_wanter() {
    let pool = pool().await;
    seed_minimal_books(&pool, 2).await;
    let alice = seed_user(&pool, "alice").await;
    let bob = seed_user(&pool, "bob").await;
    want_at(&pool, alice, "uuid-1", 100).await;
    want_at(&pool, bob, "uuid-1", 500).await;
    want_at(&pool, bob, "uuid-2", 300).await;
    want_at(&pool, bob, "no-such-book", 900).await;

    let books = wishlist_books(&pool, WishlistScope::Everyone)
        .await
        .unwrap();

    let rows: Vec<(&str, i64, Vec<&str>)> = books
        .iter()
        .map(|b| {
            (
                b.book.unique_identifier.as_deref().unwrap(),
                b.added_at,
                b.wanted_by.iter().map(|w| w.name.as_str()).collect(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        vec![
            ("uuid-1", 500, vec!["alice", "bob"]),
            ("uuid-2", 300, vec!["bob"]),
        ]
    );
}

#[tokio::test]
async fn wishlist_books_returns_user_not_found_for_an_unknown_reader() {
    let pool = pool().await;

    let err = wishlist_books(&pool, WishlistScope::Reader(999))
        .await
        .unwrap_err();

    assert!(matches!(err, PhysicalError::UserNotFound));
}

#[tokio::test]
async fn wishlist_books_propagates_db_error_when_pool_is_closed() {
    let pool = pool().await;
    let user = seed_user(&pool, "alice").await;
    pool.close().await;

    let err = wishlist_books(&pool, WishlistScope::Reader(user))
        .await
        .unwrap_err();

    assert!(matches!(err, PhysicalError::Sqlx(_)));
}

#[tokio::test]
async fn wishlist_books_counts_a_multi_part_audiobook_once() {
    let pool = pool().await;
    seed_minimal_books(&pool, 1).await;
    let alice = seed_user(&pool, "alice").await;
    want_at(&pool, alice, "uuid-1", 1).await;
    for (ordinal, part) in ["part-1.m4b", "part-2.m4b", "part-3.m4b"]
        .iter()
        .enumerate()
    {
        add_file(
            &pool,
            "uuid-1",
            "M4B",
            ordinal as i64,
            &format!("wt/{part}"),
        )
        .await;
    }

    let books = wishlist_books(&pool, WishlistScope::Reader(alice))
        .await
        .unwrap();

    let m4b = books[0]
        .holdings
        .iter()
        .find(|h| h.format == "M4B")
        .unwrap();
    assert_eq!(m4b.count, 1);
}

#[tokio::test]
async fn wishlist_books_leaves_out_descriptions_and_applies_overrides() {
    let pool = pool().await;
    seed_minimal_books(&pool, 1).await;
    let alice = seed_user(&pool, "alice").await;
    want_at(&pool, alice, "uuid-1", 1).await;
    sqlx::query("UPDATE books SET description = '<p>scanned</p>' WHERE uuid = 'uuid-1'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO metadata_overrides (book_uuid, overrides) VALUES ('uuid-1', ?)")
        .bind(r#"{"title":"Renamed","description":"<p>edited</p>"}"#)
        .execute(&pool)
        .await
        .unwrap();

    let books = wishlist_books(&pool, WishlistScope::Reader(alice))
        .await
        .unwrap();

    assert_eq!(books[0].book.title.as_deref(), Some("Renamed"));
    assert_eq!(books[0].book.description, None);
}

#[tokio::test]
async fn wishlist_readers_propagates_db_error_when_pool_is_closed() {
    let pool = pool().await;
    let user = seed_user(&pool, "alice").await;
    pool.close().await;

    let err = wishlist_readers(&pool, user).await.unwrap_err();

    assert!(matches!(err, PhysicalError::Sqlx(_)));
}
