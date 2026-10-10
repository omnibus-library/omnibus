//! Shelf filter clauses on the keyset page: hand-picked shelves and wishlists
//! resolve by id for the viewer, other readers' private shelves and smart
//! shelves match nothing, and an exclude keeps books on no listed shelf.

use omnibus_shared::physical::WishlistSource;
use omnibus_shared::FilterField::Shelf;
use omnibus_shared::FilterMode::{Exclude, Include};
use omnibus_shared::{
    CreateShelfRequest, FilterClause, FilterMode, MatchMode, RuleField, RuleOp, ShelfKind,
    ShelfRule, SortDir, SortKey, ViewFilters, Visibility,
};
use sqlx::SqlitePool;

use super::super::*;
use super::stacked::{series_book, titles_of};
use super::{clause, insert_book, insert_lib, sorted_titles, uuid_of};
use crate::books::Projection;
use crate::physical::add_wishlist_entry;
use crate::pool::init_db;
use crate::test_support::{seed_user, wishlist_shelf_id};

/// A fresh database holding one visible book per title under `/lib`; returns
/// the pool and the books' uuids in title order.
async fn library_of(titles: &[&str]) -> (SqlitePool, Vec<String>) {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let mut uuids = Vec::new();
    for title in titles {
        let id = insert_book(&pool, lib, title, None, None, None).await;
        uuids.push(uuid_of(&pool, id).await);
    }
    (pool, uuids)
}

fn reader(user_id: i64) -> Viewer {
    Viewer {
        user_id,
        is_admin: false,
    }
}

async fn manual_shelf(
    pool: &SqlitePool,
    owner: i64,
    visibility: Visibility,
    book_uuids: &[&String],
) -> i64 {
    let req = CreateShelfRequest {
        kind: ShelfKind::Manual,
        name: format!("shelf {}", uuid::Uuid::new_v4()),
        description: None,
        visibility,
        match_mode: None,
        rules: Vec::new(),
        book_uuids: book_uuids.iter().map(|u| (*u).clone()).collect(),
    };
    crate::create_shelf(pool, owner, &req).await.unwrap().id
}

/// A smart shelf whose rule matches every EPUB, so it would hold every book if read as a shelf.
async fn smart_shelf(pool: &SqlitePool, owner: i64) -> i64 {
    let req = CreateShelfRequest {
        kind: ShelfKind::Smart,
        name: "All EPUBs".into(),
        description: None,
        visibility: Visibility::Public,
        match_mode: Some(MatchMode::Any),
        rules: vec![ShelfRule {
            field: RuleField::Format,
            op: RuleOp::Includes,
            value: "epub".into(),
        }],
        book_uuids: Vec::new(),
    };
    crate::create_shelf(pool, owner, &req).await.unwrap().id
}

fn shelf_clause(mode: FilterMode, shelf_ids: &[i64]) -> FilterClause {
    let values: Vec<String> = shelf_ids.iter().map(i64::to_string).collect();
    let values: Vec<&str> = values.iter().map(String::as_str).collect();
    clause(Shelf, mode, &values)
}

/// Titles on the first page of `/lib` under `clauses`, as `viewer` sees them.
async fn titles_for(pool: &SqlitePool, viewer: Viewer, clauses: Vec<FilterClause>) -> Vec<String> {
    let filters = ViewFilters {
        clauses,
        ..Default::default()
    };
    let page = list_books_page(
        pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        &filters,
        viewer,
        &[],
        None,
        50,
    )
    .await
    .unwrap();
    sorted_titles(&page)
}

#[tokio::test]
async fn list_books_page_include_shelf_keeps_books_on_any_listed_manual_shelf() {
    let (pool, uuids) = library_of(&["Alpha", "Bravo", "Charlie", "Delta"]).await;
    let owner = seed_user(&pool, "owner").await;
    let first = manual_shelf(&pool, owner, Visibility::Private, &[&uuids[0]]).await;
    let second = manual_shelf(&pool, owner, Visibility::Private, &[&uuids[1]]).await;

    let found = titles_for(
        &pool,
        reader(owner),
        vec![shelf_clause(Include, &[first, second])],
    )
    .await;

    assert_eq!(found, ["Alpha", "Bravo"]);
}

#[tokio::test]
async fn list_books_page_exclude_shelf_keeps_books_on_no_listed_shelf() {
    let (pool, uuids) = library_of(&["Alpha", "Bravo", "Charlie", "Delta"]).await;
    let owner = seed_user(&pool, "owner").await;
    let listed = manual_shelf(&pool, owner, Visibility::Private, &[&uuids[0], &uuids[1]]).await;
    manual_shelf(&pool, owner, Visibility::Private, &[&uuids[2]]).await;

    let found = titles_for(&pool, reader(owner), vec![shelf_clause(Exclude, &[listed])]).await;

    assert_eq!(found, ["Charlie", "Delta"]);
}

#[tokio::test]
async fn list_books_page_include_shelf_keeps_the_viewers_wishlist_books() {
    let (pool, uuids) = library_of(&["Alpha", "Bravo", "Charlie"]).await;
    let owner = seed_user(&pool, "owner").await;
    let wishlist = wishlist_shelf_id(&pool, owner).await;
    add_wishlist_entry(&pool, owner, &uuids[1], WishlistSource::Detail)
        .await
        .unwrap();

    let found = titles_for(
        &pool,
        reader(owner),
        vec![shelf_clause(Include, &[wishlist])],
    )
    .await;

    assert_eq!(found, ["Bravo"]);
}

#[tokio::test]
async fn list_books_page_include_shelf_matches_nothing_for_another_readers_private_shelf() {
    let (pool, uuids) = library_of(&["Alpha", "Bravo", "Charlie"]).await;
    let owner = seed_user(&pool, "owner").await;
    let outsider = seed_user(&pool, "outsider").await;
    let private = manual_shelf(&pool, owner, Visibility::Private, &[&uuids[0]]).await;

    let found = titles_for(
        &pool,
        reader(outsider),
        vec![shelf_clause(Include, &[private])],
    )
    .await;

    assert!(found.is_empty(), "leaked {found:?}");
}

#[tokio::test]
async fn list_books_page_exclude_shelf_removes_nothing_for_another_readers_private_shelf() {
    let (pool, uuids) = library_of(&["Alpha", "Bravo", "Charlie"]).await;
    let owner = seed_user(&pool, "owner").await;
    let outsider = seed_user(&pool, "outsider").await;
    let private = manual_shelf(&pool, owner, Visibility::Private, &[&uuids[0]]).await;

    let found = titles_for(
        &pool,
        reader(outsider),
        vec![shelf_clause(Exclude, &[private])],
    )
    .await;

    assert_eq!(found, ["Alpha", "Bravo", "Charlie"]);
}

#[tokio::test]
async fn list_books_page_include_shelf_matches_another_readers_public_shelf() {
    let (pool, uuids) = library_of(&["Alpha", "Bravo", "Charlie"]).await;
    let owner = seed_user(&pool, "owner").await;
    let outsider = seed_user(&pool, "outsider").await;
    let public = manual_shelf(&pool, owner, Visibility::Public, &[&uuids[2]]).await;

    let found = titles_for(
        &pool,
        reader(outsider),
        vec![shelf_clause(Include, &[public])],
    )
    .await;

    assert_eq!(found, ["Charlie"]);
}

#[tokio::test]
async fn list_books_page_include_shelf_matches_a_private_shelf_for_an_admin() {
    let (pool, uuids) = library_of(&["Alpha", "Bravo", "Charlie"]).await;
    let owner = seed_user(&pool, "owner").await;
    let admin = Viewer {
        user_id: seed_user(&pool, "admin").await,
        is_admin: true,
    };
    let private = manual_shelf(&pool, owner, Visibility::Private, &[&uuids[0]]).await;

    let found = titles_for(&pool, admin, vec![shelf_clause(Include, &[private])]).await;

    assert_eq!(found, ["Alpha"]);
}

#[tokio::test]
async fn list_books_page_include_shelf_matches_nothing_for_a_smart_shelf() {
    let (pool, uuids) = library_of(&["Alpha", "Bravo"]).await;
    let owner = seed_user(&pool, "owner").await;
    add_wishlist_entry(&pool, owner, &uuids[1], WishlistSource::Detail)
        .await
        .unwrap();
    let smart = smart_shelf(&pool, owner).await;

    let found = titles_for(&pool, reader(owner), vec![shelf_clause(Include, &[smart])]).await;

    assert!(found.is_empty(), "smart shelf leaked {found:?}");
}

#[tokio::test]
async fn list_books_page_ignores_a_non_numeric_shelf_value() {
    let (pool, _uuids) = library_of(&["Alpha", "Bravo"]).await;
    let owner = seed_user(&pool, "owner").await;

    let found = titles_for(
        &pool,
        reader(owner),
        vec![clause(Shelf, Include, &["not-a-shelf-id"])],
    )
    .await;

    assert_eq!(found, ["Alpha", "Bravo"]);
}

#[tokio::test]
async fn list_books_page_stacked_stacks_only_the_members_on_the_listed_shelf() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let lib = insert_lib(&pool, "/lib").await;
    let one = series_book(&pool, lib, "Saga One", Some("Saga"), Some(1.0)).await;
    let two = series_book(&pool, lib, "Saga Two", Some("Saga"), Some(2.0)).await;
    series_book(&pool, lib, "Saga Three", Some("Saga"), Some(3.0)).await;
    let owner = seed_user(&pool, "owner").await;
    let (one, two) = (uuid_of(&pool, one).await, uuid_of(&pool, two).await);
    let private = manual_shelf(&pool, owner, Visibility::Private, &[&one, &two]).await;
    let filters = ViewFilters {
        clauses: vec![shelf_clause(Include, &[private])],
        ..Default::default()
    };

    let page = list_books_page_stacked(
        &pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        &filters,
        reader(owner),
        &[],
        None,
        50,
        Projection::Full,
    )
    .await
    .unwrap();

    assert_eq!(titles_of(&page.books), ["Saga One"]);
    assert_eq!(page.stacks.len(), 1);
    assert_eq!(titles_of(&page.stacks[0].members), ["Saga One", "Saga Two"]);
}

#[tokio::test]
async fn count_books_page_counts_a_private_shelf_only_for_its_owner() {
    let (pool, uuids) = library_of(&["Alpha", "Bravo", "Charlie"]).await;
    let owner = seed_user(&pool, "owner").await;
    let outsider = seed_user(&pool, "outsider").await;
    let private = manual_shelf(&pool, owner, Visibility::Private, &[&uuids[0], &uuids[1]]).await;
    let filters = ViewFilters {
        clauses: vec![shelf_clause(Include, &[private])],
        ..Default::default()
    };

    let owners = count_books_page(&pool, &["/lib"], &filters, reader(owner), &[])
        .await
        .unwrap();
    let outsiders = count_books_page(&pool, &["/lib"], &filters, reader(outsider), &[])
        .await
        .unwrap();

    assert_eq!((owners, outsiders), (2, 0));
}
