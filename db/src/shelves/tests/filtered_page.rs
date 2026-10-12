//! `shelf_page` narrowed by a library filter: each shelf kind keeps its own
//! member order while the filter drops the books that don't match, and a
//! shelf clause can name a different shelf.

use omnibus_shared::physical::WishlistSource;
use omnibus_shared::{
    FilterClause, FilterField, FilterMode, MatchMode, RuleField, RuleOp, ShelfRule, SortDir,
    SortKey, ViewFilters, Visibility,
};
use sqlx::SqlitePool;

use super::super::*;
use super::{make_user, manual_req, smart_req, uuid_by_title};
use crate::physical::add_wishlist_entry;
use crate::pool::init_db;
use crate::sync::replace_books;
use crate::test_support::{indexed, wishlist_shelf_id, CoversTempDir};

/// Four visible books under `/lib`: Alpha and Charlie tagged `red`, Bravo
/// tagged `blue`, Delta untagged.
async fn tagged_library() -> (SqlitePool, CoversTempDir) {
    let covers = CoversTempDir::new("shelf_filtered_page");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![
            indexed(
                "alpha.epub",
                Some("Alpha"),
                &["A. Writer"],
                &["red"],
                None,
                None,
            ),
            indexed(
                "bravo.epub",
                Some("Bravo"),
                &["B. Writer"],
                &["blue"],
                None,
                None,
            ),
            indexed(
                "charlie.epub",
                Some("Charlie"),
                &["C. Writer"],
                &["red"],
                None,
                None,
            ),
            indexed("delta.epub", Some("Delta"), &["D. Writer"], &[], None, None),
        ],
    )
    .await
    .unwrap();
    (pool, covers)
}

fn filter_of(field: FilterField, mode: FilterMode, values: &[&str]) -> ViewFilters {
    ViewFilters {
        clauses: vec![FilterClause {
            field,
            mode,
            values: values.iter().map(|v| (*v).to_string()).collect(),
        }],
    }
}

async fn titles_on(
    pool: &SqlitePool,
    shelf: &omnibus_shared::Shelf,
    sort: SortKey,
    dir: SortDir,
    filters: &ViewFilters,
    viewer: Viewer,
) -> Vec<String> {
    shelf_page(pool, shelf, sort, dir, filters, viewer)
        .await
        .unwrap()
        .books
        .iter()
        .filter_map(|b| b.title.clone())
        .collect()
}

#[tokio::test]
async fn shelf_page_narrows_a_manual_shelf_by_the_filter_and_keeps_its_hand_order() {
    let (pool, _covers) = tagged_library().await;
    let owner = make_user(&pool, "owner", false).await;
    let mut hand_picked = Vec::new();
    for title in ["Charlie", "Alpha", "Bravo", "Delta"] {
        hand_picked.push(uuid_by_title(&pool, title).await);
    }
    let shelf = create_shelf(&pool, owner, &manual_req("Picks", hand_picked))
        .await
        .unwrap();

    let found = titles_on(
        &pool,
        &shelf,
        SortKey::Title,
        SortDir::Asc,
        &filter_of(FilterField::Tag, FilterMode::Include, &["red"]),
        Viewer::default(),
    )
    .await;

    assert_eq!(found, ["Charlie", "Alpha"]);
}

#[tokio::test]
async fn shelf_page_narrows_a_smart_shelf_by_the_filter_and_keeps_its_sort() {
    let (pool, _covers) = tagged_library().await;
    let owner = make_user(&pool, "owner", false).await;
    let everything = ShelfRule {
        field: RuleField::Format,
        op: RuleOp::Includes,
        value: "EPUB".into(),
    };
    let shelf = create_shelf(
        &pool,
        owner,
        &smart_req("All", MatchMode::Any, vec![everything]),
    )
    .await
    .unwrap();

    let found = titles_on(
        &pool,
        &shelf,
        SortKey::Title,
        SortDir::Desc,
        &filter_of(FilterField::Tag, FilterMode::Exclude, &["red"]),
        Viewer::default(),
    )
    .await;

    assert_eq!(found, ["Delta", "Bravo"]);
}

#[tokio::test]
async fn shelf_page_narrows_the_wishlist_by_the_filter() {
    let (pool, _covers) = tagged_library().await;
    let owner = make_user(&pool, "owner", false).await;
    let wishlist = wishlist_shelf_id(&pool, owner).await;
    let someday = crate::physical::create_fileless_book(
        &pool,
        crate::physical::FilelessBook {
            title: "Someday".into(),
            authors: vec!["Ada Lovelace".into()],
            isbn: None,
            pubdate: None,
            description: None,
            cover: None,
        },
    )
    .await
    .unwrap();
    for uuid in [uuid_by_title(&pool, "Alpha").await, someday] {
        add_wishlist_entry(&pool, owner, &uuid, WishlistSource::Detail)
            .await
            .unwrap();
    }
    let shelf = get_shelf(&pool, wishlist).await.unwrap().unwrap();

    let found = titles_on(
        &pool,
        &shelf,
        SortKey::Title,
        SortDir::Asc,
        &filter_of(FilterField::Author, FilterMode::Include, &["Ada Lovelace"]),
        Viewer::default(),
    )
    .await;

    assert_eq!(found, ["Someday"], "a fileless entry stays eligible");
}

#[tokio::test]
async fn shelf_page_intersects_with_a_shelf_clause_naming_another_shelf() {
    let (pool, _covers) = tagged_library().await;
    let owner = make_user(&pool, "owner", false).await;
    let mut first = Vec::new();
    for title in ["Charlie", "Alpha", "Bravo"] {
        first.push(uuid_by_title(&pool, title).await);
    }
    let mut second = Vec::new();
    for title in ["Delta", "Bravo", "Charlie"] {
        second.push(uuid_by_title(&pool, title).await);
    }
    let picks = create_shelf(&pool, owner, &manual_req("Picks", first))
        .await
        .unwrap();
    let other = create_shelf(&pool, owner, &manual_req("Other", second))
        .await
        .unwrap();
    let viewer = Viewer {
        user_id: owner,
        is_admin: false,
    };

    let found = titles_on(
        &pool,
        &picks,
        SortKey::Title,
        SortDir::Asc,
        &filter_of(
            FilterField::Shelf,
            FilterMode::Include,
            &[&other.id.to_string()],
        ),
        viewer,
    )
    .await;

    assert_eq!(found, ["Charlie", "Bravo"]);
}

#[tokio::test]
async fn shelf_page_shelf_clause_matches_nothing_for_another_readers_private_shelf() {
    let (pool, _covers) = tagged_library().await;
    let owner = make_user(&pool, "owner", false).await;
    let outsider = make_user(&pool, "outsider", false).await;
    let mut public_req = manual_req(
        "Public",
        vec![
            uuid_by_title(&pool, "Charlie").await,
            uuid_by_title(&pool, "Alpha").await,
            uuid_by_title(&pool, "Bravo").await,
        ],
    );
    public_req.visibility = Visibility::Public;
    let public = create_shelf(&pool, owner, &public_req).await.unwrap();
    let private = create_shelf(
        &pool,
        owner,
        &manual_req(
            "Private",
            vec![
                uuid_by_title(&pool, "Delta").await,
                uuid_by_title(&pool, "Bravo").await,
                uuid_by_title(&pool, "Charlie").await,
            ],
        ),
    )
    .await
    .unwrap();
    let viewer = Viewer {
        user_id: outsider,
        is_admin: false,
    };
    let private_id = private.id.to_string();

    let included = titles_on(
        &pool,
        &public,
        SortKey::Title,
        SortDir::Asc,
        &filter_of(FilterField::Shelf, FilterMode::Include, &[&private_id]),
        viewer,
    )
    .await;
    let excluded = titles_on(
        &pool,
        &public,
        SortKey::Title,
        SortDir::Asc,
        &filter_of(FilterField::Shelf, FilterMode::Exclude, &[&private_id]),
        viewer,
    )
    .await;

    assert!(included.is_empty(), "leaked {included:?}");
    assert_eq!(excluded, ["Charlie", "Alpha", "Bravo"]);
}
