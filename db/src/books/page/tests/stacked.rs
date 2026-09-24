//! Series stacking over the keyset page: one representative per series in
//! its first-sort slot, a cursor walk that never splits a series,
//! exclusions/overrides reshaping groups, and the viewer's reading state.

use omnibus_shared::{EbookMetadata, SortDir, SortKey, StackMemberState, ViewFilters};
use sqlx::SqlitePool;

use super::super::*;
use super::{insert_book, insert_lib, set_overrides_json};
use crate::pool::init_db;
use crate::test_support::seed_user;

/// One stacked page of `/lib`, unfiltered, read for a viewer with no state.
async fn stacked_page(
    pool: &SqlitePool,
    sort: SortKey,
    dir: SortDir,
    cursor: Option<&PageCursor>,
    limit: i64,
) -> StackedBookPage {
    list_books_page_stacked(
        pool,
        &["/lib"],
        sort,
        dir,
        &ViewFilters::default(),
        &[],
        cursor,
        limit,
        0,
    )
    .await
    .unwrap()
}

fn titles_of(books: &[EbookMetadata]) -> Vec<String> {
    books
        .iter()
        .map(|b| b.title.clone().unwrap_or_default())
        .collect()
}

/// Link `book_id` to the series row named `name`, creating it; returns its id.
async fn link_series(pool: &SqlitePool, book_id: i64, name: &str) -> i64 {
    sqlx::query("INSERT OR IGNORE INTO series (name, sort) VALUES (?, ?)")
        .bind(name)
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
    let id: i64 = sqlx::query_scalar("SELECT id FROM series WHERE name = ?")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO books_series_link (book, series) VALUES (?, ?)")
        .bind(book_id)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    id
}

/// A titled book in `series` at `index`, linked the way the indexer links it.
async fn series_book(
    pool: &SqlitePool,
    lib: i64,
    title: &str,
    series: Option<&str>,
    index: Option<f64>,
) -> i64 {
    let id = insert_book(pool, lib, title, Some(title), series, index).await;
    if let Some(name) = series {
        link_series(pool, id, name).await;
    }
    id
}

async fn set_added(pool: &SqlitePool, id: i64, epoch: i64) {
    sqlx::query("UPDATE books SET timestamp = ? WHERE id = ?")
        .bind(epoch)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

async fn uuid_of(pool: &SqlitePool, id: i64) -> String {
    sqlx::query_scalar("SELECT uuid FROM books WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn list_books_page_stacked_folds_a_series_onto_its_first_member_and_keeps_the_rest() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    series_book(&pool, lib, "Saga Two", Some("Saga"), Some(2.0)).await;
    series_book(&pool, lib, "Lonely", Some("Solo"), Some(1.0)).await;
    let one = series_book(&pool, lib, "Saga One", Some("Saga"), Some(1.0)).await;
    series_book(&pool, lib, "Plain", None, None).await;

    let page = stacked_page(&pool, SortKey::Title, SortDir::Asc, None, 50).await;

    assert_eq!(titles_of(&page.books), vec!["Lonely", "Plain", "Saga One"]);
    assert_eq!(page.stacks.len(), 1, "a one-book series stays a plain tile");
    assert_eq!(page.stacks[0].lead_uuid, uuid_of(&pool, one).await);
    assert_eq!(page.stacks[0].name, "Saga");
    assert_eq!(
        titles_of(&page.stacks[0].members),
        vec!["Saga One", "Saga Two"]
    );
}

#[tokio::test]
async fn list_books_page_stacked_places_the_stack_at_its_newest_member_under_newest_added() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let one = series_book(&pool, lib, "Saga One", Some("Saga"), Some(1.0)).await;
    let plain = series_book(&pool, lib, "Plain", None, None).await;
    let two = series_book(&pool, lib, "Saga Two", Some("Saga"), Some(2.0)).await;
    set_added(&pool, one, 100).await;
    set_added(&pool, plain, 200).await;
    set_added(&pool, two, 300).await;

    let page = stacked_page(&pool, SortKey::NewestAdded, SortDir::Desc, None, 50).await;

    assert_eq!(titles_of(&page.books), vec!["Saga Two", "Plain"]);
    assert_eq!(page.stacks[0].lead_uuid, uuid_of(&pool, two).await);
    assert_eq!(
        titles_of(&page.stacks[0].members),
        vec!["Saga One", "Saga Two"]
    );
}

#[tokio::test]
async fn list_books_page_stacked_walks_every_tile_once_without_splitting_a_series() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    // Round-robin over five series so every series spans the whole title order.
    for i in 0..15 {
        let series = format!("Series {}", i % 5);
        let index = f64::from(i / 5 + 1);
        series_book(
            &pool,
            lib,
            &format!("Book {i:02}"),
            Some(&series),
            Some(index),
        )
        .await;
    }
    for i in 0..5 {
        series_book(&pool, lib, &format!("Plain {i}"), None, None).await;
    }

    let mut tiles = Vec::new();
    let mut stack_sizes = Vec::new();
    let mut cursor: Option<PageCursor> = None;
    loop {
        let page = stacked_page(&pool, SortKey::Title, SortDir::Asc, cursor.as_ref(), 3).await;
        tiles.extend(titles_of(&page.books));
        stack_sizes.extend(page.stacks.iter().map(|s| s.members.len()));
        match page.next {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }

    assert_eq!(
        tiles,
        vec![
            "Book 00", "Book 01", "Book 02", "Book 03", "Book 04", "Plain 0", "Plain 1", "Plain 2",
            "Plain 3", "Plain 4",
        ]
    );
    assert_eq!(stack_sizes, vec![3, 3, 3, 3, 3], "each series once, whole");
}

#[tokio::test]
async fn list_books_page_stacked_unstacks_a_series_an_exclusion_cuts_to_one_book() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    series_book(&pool, lib, "Saga One", Some("Saga"), Some(1.0)).await;
    let two = series_book(&pool, lib, "Saga Two", Some("Saga"), Some(2.0)).await;
    sqlx::query("UPDATE book_files SET format = 'CBZ' WHERE book_id = ?")
        .bind(two)
        .execute(&pool)
        .await
        .unwrap();

    let hidden = ["cbz".to_string()];
    let page = list_books_page_stacked(
        &pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        &hidden,
        None,
        50,
        0,
    )
    .await
    .unwrap();
    assert_eq!(titles_of(&page.books), vec!["Saga One"]);
    assert!(page.stacks.is_empty(), "one visible book is a plain tile");

    let all = stacked_page(&pool, SortKey::Title, SortDir::Asc, None, 50).await;
    assert_eq!(all.stacks.len(), 1);
}

#[tokio::test]
async fn list_books_page_stacked_groups_by_the_override_series_name() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let alpha = series_book(&pool, lib, "Alpha", Some("Old"), Some(1.0)).await;
    series_book(&pool, lib, "Bravo", Some("New"), Some(1.0)).await;
    series_book(&pool, lib, "Charlie", Some("Old"), Some(2.0)).await;
    set_overrides_json(&pool, alpha, r#"{"series":"New","series_index":"2"}"#).await;

    let page = stacked_page(&pool, SortKey::Title, SortDir::Asc, None, 50).await;

    assert_eq!(titles_of(&page.books), vec!["Alpha", "Charlie"]);
    assert_eq!(page.stacks.len(), 1, "\"Old\" is down to Charlie alone");
    assert_eq!(page.stacks[0].name, "New");
    assert_eq!(titles_of(&page.stacks[0].members), vec!["Bravo", "Alpha"]);
}

#[tokio::test]
async fn list_books_page_stacked_treats_an_emptied_series_override_as_no_series() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    series_book(&pool, lib, "Alpha", Some("Saga"), Some(1.0)).await;
    let bravo = series_book(&pool, lib, "Bravo", Some("Saga"), Some(2.0)).await;
    set_overrides_json(&pool, bravo, r#"{"series":""}"#).await;

    let page = stacked_page(&pool, SortKey::Title, SortDir::Asc, None, 50).await;

    assert_eq!(titles_of(&page.books), vec!["Alpha", "Bravo"]);
    assert!(page.stacks.is_empty());
}

#[tokio::test]
async fn list_books_page_stacked_orders_members_by_series_index_with_unnumbered_last() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    series_book(&pool, lib, "Zeta", Some("Saga"), Some(2.0)).await;
    series_book(&pool, lib, "Alpha", Some("Saga"), None).await;
    series_book(&pool, lib, "Mid", Some("Saga"), Some(1.0)).await;

    let page = stacked_page(&pool, SortKey::Title, SortDir::Asc, None, 50).await;

    assert_eq!(titles_of(&page.books), vec!["Alpha"]);
    assert_eq!(
        titles_of(&page.stacks[0].members),
        vec!["Mid", "Zeta", "Alpha"]
    );
}

#[tokio::test]
async fn list_books_page_stacked_resolves_the_series_page_by_the_displayed_name() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let a = series_book(&pool, lib, "Alpha", Some("Old"), Some(1.0)).await;
    let b = series_book(&pool, lib, "Bravo", Some("Old"), Some(2.0)).await;
    // Renamed to "Zenith"; the projection's `series_id` still points at "Old".
    let zenith = link_series(&pool, a, "Zenith").await;
    set_overrides_json(&pool, a, r#"{"series":"Zenith"}"#).await;
    set_overrides_json(&pool, b, r#"{"series":"Zenith"}"#).await;

    let page = stacked_page(&pool, SortKey::Title, SortDir::Asc, None, 50).await;

    assert_eq!(page.stacks[0].name, "Zenith");
    assert_eq!(page.stacks[0].series_id, Some(zenith));
}

#[tokio::test]
async fn list_books_page_stacked_groups_by_the_linked_series_even_when_series_sort_lags_a_rename() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    // `series_sort` on two of three is stale (never re-derived when a link
    // moves, e.g. a cleanup/merge) even though all three link to one series.
    let a = insert_book(&pool, lib, "Foundation", Some("Foundation"), Some("Foundation Series"), Some(1.0)).await;
    let b = insert_book(
        &pool,
        lib,
        "Foundation and Empire",
        Some("Foundation and Empire"),
        Some("Foundation Series"),
        Some(2.0),
    )
    .await;
    let c = insert_book(
        &pool,
        lib,
        "Second Foundation",
        Some("Second Foundation"),
        Some("The Foundation Series"),
        Some(3.0),
    )
    .await;
    for id in [a, b, c] {
        link_series(&pool, id, "The Foundation Series").await;
    }

    let page = stacked_page(&pool, SortKey::Title, SortDir::Asc, None, 50).await;

    assert_eq!(page.stacks.len(), 1, "series_sort drift must not split the stack");
    assert_eq!(page.stacks[0].name, "The Foundation Series");
    assert_eq!(
        titles_of(&page.stacks[0].members),
        vec!["Foundation", "Foundation and Empire", "Second Foundation"]
    );
}

#[tokio::test]
async fn list_books_page_stacked_reports_reading_state_for_the_viewer_only() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let one = series_book(&pool, lib, "Saga One", Some("Saga"), Some(1.0)).await;
    let two = series_book(&pool, lib, "Saga Two", Some("Saga"), Some(2.0)).await;
    let (one_uuid, two_uuid) = (uuid_of(&pool, one).await, uuid_of(&pool, two).await);
    let viewer = seed_user(&pool, "viewer").await;
    let other = seed_user(&pool, "other").await;
    sqlx::query(
        "INSERT INTO reading_progress (user_id, book_uuid, format, epub_cfi, progress_percent)
         VALUES (?, ?, 'epub', 'epubcfi(/6/2!/4)', 40)",
    )
    .bind(viewer)
    .bind(&two_uuid)
    .execute(&pool)
    .await
    .unwrap();
    for (user, uuid) in [(viewer, &one_uuid), (other, &two_uuid)] {
        sqlx::query(
            "INSERT INTO book_read_status (user_id, book_uuid, status) VALUES (?, ?, 'finished')",
        )
        .bind(user)
        .bind(uuid)
        .execute(&pool)
        .await
        .unwrap();
    }

    let page = list_books_page_stacked(
        &pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        &[],
        None,
        50,
        viewer,
    )
    .await
    .unwrap();

    assert_eq!(
        page.stacks[0].states,
        vec![
            StackMemberState {
                uuid: one_uuid,
                percent: None,
                started: true,
                finished: true
            },
            StackMemberState {
                uuid: two_uuid,
                percent: Some(40),
                started: true,
                finished: false
            },
        ]
    );
}

#[tokio::test]
async fn list_books_page_stacked_surfaces_a_db_error_when_the_pool_is_closed() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    series_book(&pool, lib, "Saga One", Some("Saga"), Some(1.0)).await;
    pool.close().await;

    let result = list_books_page_stacked(
        &pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        &[],
        None,
        50,
        0,
    )
    .await;

    assert!(matches!(result, Err(crate::books::BooksError::Db(_))));
}
