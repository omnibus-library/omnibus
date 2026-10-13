//! `Projection::List` keyset reads: browse rows never carry `description`
//! (scanned or from an override) and drop nothing else, while the `Full`
//! reads (`list_books_page`, the detail read) keep it.

use omnibus_shared::{EbookMetadata, SortDir, SortKey, ViewFilters};
use sqlx::SqlitePool;

use super::super::*;
use super::stacked::series_book;
use super::{ids, insert_book, insert_lib, set_overrides_json, uuid_of};
use crate::books::get_book_by_uuid;
use crate::pool::init_db;

const BLURB: &str = "<p>A <b>scanned</b> blurb.</p>";

async fn set_description(pool: &SqlitePool, id: i64, description: &str) {
    sqlx::query("UPDATE books SET description = ? WHERE id = ?")
        .bind(description)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

async fn set_timestamp(pool: &SqlitePool, id: i64, epoch: i64) {
    sqlx::query("UPDATE books SET timestamp = ? WHERE id = ?")
        .bind(epoch)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

/// The first 50 rows of `/lib`, title ascending, read through `projection`.
async fn title_page(pool: &SqlitePool, projection: Projection) -> BookPage {
    list_books_page_projected(
        pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        None,
        50,
        projection,
    )
    .await
    .unwrap()
}

/// The first 50 stacked rows of `/lib`, title ascending, for a viewer with no state.
async fn stacked_title_page(pool: &SqlitePool, projection: Projection) -> StackedBookPage {
    list_books_page_stacked(
        pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        None,
        50,
        projection,
    )
    .await
    .unwrap()
}

/// Every id of a `RecentlyInteracted` / Desc walk, two rows per page.
async fn interacted_walk(pool: &SqlitePool, projection: Projection) -> Vec<i64> {
    let mut walked = Vec::new();
    let mut cursor: Option<PageCursor> = None;
    loop {
        let page = list_books_page_projected(
            pool,
            &["/lib"],
            SortKey::RecentlyInteracted,
            SortDir::Desc,
            &ViewFilters::default(),
            Viewer::default(),
            &[],
            cursor.as_ref(),
            2,
            projection,
        )
        .await
        .unwrap();
        walked.extend(ids(&page));
        match page.next {
            Some(next) => cursor = Some(next),
            None => return walked,
        }
    }
}

#[tokio::test]
async fn list_books_page_projected_drops_the_scanned_description_under_list() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let id = insert_book(&pool, lib, "Dune", Some("Dune"), None, None).await;
    set_description(&pool, id, BLURB).await;

    let page = title_page(&pool, Projection::List).await;

    assert_eq!(page.books.len(), 1);
    assert_eq!(page.books[0].description, None);
    assert_eq!(page.books[0].title.as_deref(), Some("Dune"));
}

#[tokio::test]
async fn list_books_page_projected_drops_an_override_description_but_keeps_has_override() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let id = insert_book(&pool, lib, "Dune", Some("Dune"), None, None).await;
    set_overrides_json(
        &pool,
        id,
        r#"{"title":"Dune Messiah","description":"<p>Override blurb</p>"}"#,
    )
    .await;

    let list = title_page(&pool, Projection::List).await;
    let full = title_page(&pool, Projection::Full).await;

    assert_eq!(
        full.books[0].description.as_deref(),
        Some("<p>Override blurb</p>"),
        "the Full read merges the override description"
    );
    assert_eq!(list.books[0].description, None);
    assert!(list.books[0].has_override);
    assert_eq!(list.books[0].title.as_deref(), Some("Dune Messiah"));
}

#[tokio::test]
async fn list_books_page_projected_list_row_equals_the_full_row_without_its_description() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let plain = insert_book(&pool, lib, "Alpha", Some("Alpha"), None, None).await;
    set_description(&pool, plain, BLURB).await;
    let edited = insert_book(&pool, lib, "Bravo", Some("Bravo"), None, None).await;
    set_description(&pool, edited, BLURB).await;
    set_overrides_json(
        &pool,
        edited,
        r#"{"title":"Bravo Prime","publisher":"Acme","description":"<p>Edited</p>"}"#,
    )
    .await;

    let list = title_page(&pool, Projection::List).await;
    let full = title_page(&pool, Projection::Full).await;

    assert!(
        full.books.iter().all(|b| b.description.is_some()),
        "the fixture must give the Full rows a description to drop"
    );
    let stripped: Vec<EbookMetadata> = full
        .books
        .into_iter()
        .map(|b| EbookMetadata {
            description: None,
            ..b
        })
        .collect();
    assert_eq!(list.books, stripped);
    assert_eq!(list.next, full.next);
}

#[tokio::test]
async fn list_books_page_keeps_the_sanitized_description_for_opds() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let id = insert_book(&pool, lib, "Dune", Some("Dune"), None, None).await;
    set_description(&pool, id, "<p>Hi <b>there</b></p><script>alert(1)</script>").await;

    let page = list_books_page(
        &pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        None,
        50,
    )
    .await
    .unwrap();

    assert_eq!(
        page.books[0].description.as_deref(),
        Some("<p>Hi <b>there</b></p>")
    );
}

#[tokio::test]
async fn get_book_by_uuid_keeps_the_description_the_list_projection_drops() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let id = insert_book(&pool, lib, "Dune", Some("Dune"), None, None).await;
    set_description(&pool, id, BLURB).await;
    let uuid = uuid_of(&pool, id).await;

    let list = title_page(&pool, Projection::List).await;
    let detail = get_book_by_uuid(&pool, &uuid).await.unwrap().unwrap();

    assert_eq!(list.books[0].description, None);
    assert_eq!(detail.description.as_deref(), Some(BLURB));
}

#[tokio::test]
async fn list_books_page_projected_walks_the_recently_interacted_cursor_like_full() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let a = insert_book(&pool, lib, "A", Some("A"), None, None).await;
    let b = insert_book(&pool, lib, "B", Some("B"), None, None).await;
    let c = insert_book(&pool, lib, "C", Some("C"), None, None).await;
    let d = insert_book(&pool, lib, "D", Some("D"), None, None).await;
    // Interaction order (newest first) deliberately differs from insert order.
    for (id, epoch) in [(a, 300), (b, 100), (c, 400), (d, 200)] {
        set_timestamp(&pool, id, epoch).await;
        set_description(&pool, id, BLURB).await;
    }

    let full = interacted_walk(&pool, Projection::Full).await;
    let list = interacted_walk(&pool, Projection::List).await;

    assert_eq!(full, vec![c, a, d, b]);
    assert_eq!(list, full);
}

#[tokio::test]
async fn list_books_page_stacked_drops_descriptions_from_rows_and_members_under_list() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let one = series_book(&pool, lib, "Saga One", Some("Saga"), Some(1.0)).await;
    let two = series_book(&pool, lib, "Saga Two", Some("Saga"), Some(2.0)).await;
    let solo = series_book(&pool, lib, "Standalone", None, None).await;
    for id in [one, two, solo] {
        set_description(&pool, id, BLURB).await;
    }

    let full = stacked_title_page(&pool, Projection::Full).await;
    let list = stacked_title_page(&pool, Projection::List).await;

    assert_eq!(
        full.books.len(),
        2,
        "the stack folds to one row plus the solo"
    );
    assert!(full.books.iter().all(|b| b.description.is_some()));
    assert!(full.stacks[0]
        .members
        .iter()
        .all(|m| m.description.is_some()));
    assert_eq!(list.books.len(), 2);
    assert!(list.books.iter().all(|b| b.description.is_none()));
    assert_eq!(list.stacks[0].members.len(), 2);
    assert!(list.stacks[0]
        .members
        .iter()
        .all(|m| m.description.is_none()));
}

#[tokio::test]
async fn list_books_page_projected_surfaces_a_db_error_when_the_pool_is_closed() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    insert_book(&pool, lib, "Dune", Some("Dune"), None, None).await;
    pool.close().await;

    let result = list_books_page_projected(
        &pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        &ViewFilters::default(),
        Viewer::default(),
        &[],
        None,
        50,
        Projection::List,
    )
    .await;

    assert!(matches!(result, Err(crate::books::BooksError::Db(_))));
}
