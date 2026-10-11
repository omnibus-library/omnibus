//! Mobile shelf page transport tests: the filter rides one query param, and a
//! cached page answers only the filter it was cached under.
#![allow(clippy::await_holding_lock)]

use axum::extract::Query;
use axum::routing::get;
use axum::Json;
use omnibus_shared::{
    EbookMetadata, FilterClause, FilterField, FilterMode, ShelfPage, SortDir, SortKey, ViewFilters,
};

use crate::offline::sync::test_state_lock;
use crate::offline::{cache, store, test_support::spawn_router};

use super::*;

fn shelf_filter() -> ViewFilters {
    ViewFilters {
        clauses: vec![FilterClause {
            field: FilterField::Shelf,
            mode: FilterMode::Include,
            values: vec!["12".into()],
        }],
        ..Default::default()
    }
}

fn book(title: &str) -> EbookMetadata {
    EbookMetadata {
        title: Some(title.to_string()),
        ..Default::default()
    }
}

/// Serve shelf 7's page answering one book titled with the `filter` query
/// value it received (`absent` when the request carried none).
async fn spawn_filter_echo() -> String {
    let app = axum::Router::new().route(
        "/api/shelves/7/page",
        get(
            |Query(params): Query<std::collections::HashMap<String, String>>| async move {
                let echoed = params
                    .get("filter")
                    .cloned()
                    .unwrap_or_else(|| "absent".to_string());
                Json(ShelfPage {
                    books: vec![book(&echoed)],
                })
            },
        ),
    );
    spawn_router(app).await
}

#[tokio::test]
async fn shelf_page_online_sends_the_filter_param() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let base = spawn_filter_echo().await;

    let page = shelf_page_online(&base, 7, SortKey::Title, SortDir::Asc, shelf_filter())
        .await
        .expect("page");

    let sent: Vec<FilterClause> =
        serde_json::from_str(page.books[0].title.as_deref().unwrap()).expect("filter json");
    assert_eq!(sent, shelf_filter().clauses);
}

#[tokio::test]
async fn shelf_page_online_omits_the_filter_param_without_a_filter() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let base = spawn_filter_echo().await;

    let page = shelf_page_online(
        &base,
        7,
        SortKey::Title,
        SortDir::Asc,
        ViewFilters::default(),
    )
    .await
    .expect("page");

    assert_eq!(page.books[0].title.as_deref(), Some("absent"));
}

#[tokio::test]
async fn shelf_page_serves_the_cached_page_only_for_the_filter_it_was_cached_under() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let filter = shelf_filter().to_query_param().unwrap();
    cache::put_json(
        &cache::keys::shelf_page(8, SortKey::Title.as_wire(), SortDir::Asc.as_wire(), &filter),
        &ShelfPage {
            books: vec![book("Cached Under Filter")],
        },
    );

    let filtered = shelf_page(
        "http://127.0.0.1:1",
        8,
        SortKey::Title,
        SortDir::Asc,
        shelf_filter(),
    )
    .await
    .expect("cached filtered page");
    let unfiltered = shelf_page(
        "http://127.0.0.1:1",
        8,
        SortKey::Title,
        SortDir::Asc,
        ViewFilters::default(),
    )
    .await;

    assert_eq!(
        filtered.books[0].title.as_deref(),
        Some("Cached Under Filter")
    );
    assert!(unfiltered.is_err(), "the whole-shelf key was never cached");
    crate::offline::sync::note_online();
}
