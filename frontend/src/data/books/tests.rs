//! `get_ebooks_page` policy tests: known-offline replica fast path, the
//! cached-first-page (SWR) short-circuit, and the replica fallback when the
//! first fetch dies mid-request.

// The state-lock guard is deliberately held across awaits: it serializes
// whole async test bodies against process-global state, and each test owns
// its own thread + runtime, so there is no interleaving to deadlock on.
#![allow(clippy::await_holding_lock)]

use omnibus_shared::{
    Contributor, EbookMetadata, FilterClause, FilterField, FilterMode, LibraryPage, SortDir,
    SortKey, ViewFilters,
};

use crate::offline::cache;
use crate::offline::store;
use crate::offline::sync::test_state_lock;

use super::*;

fn book(title: &str) -> EbookMetadata {
    EbookMetadata {
        title: Some(title.to_string()),
        filename: format!("{title}.epub"),
        creators: vec![Contributor {
            name: "Author".into(),
            ..Default::default()
        }],
        formats: vec!["EPUB".into()],
        unique_identifier: Some(format!("uuid-{title}")),
        ..Default::default()
    }
}

fn titles(page: &LibraryPage) -> Vec<String> {
    page.books
        .iter()
        .map(|b| b.title.clone().unwrap_or_default())
        .collect()
}

#[tokio::test]
async fn get_ebooks_page_serves_replica_when_known_offline() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    cache::put_json(
        &cache::keys::ebooks_all(),
        &vec![book("Dune"), book("Atonement")],
    );
    crate::offline::sync::note_offline();

    let page = get_ebooks_page(
        "http://127.0.0.1:1",
        SortKey::Title,
        SortDir::Asc,
        ViewFilters::default(),
        Vec::new(),
        None,
        10,
        false,
    )
    .await
    .expect("replica page");
    assert_eq!(titles(&page), vec!["Atonement", "Dune"]);
    crate::offline::sync::note_online();
}

#[tokio::test]
async fn get_ebooks_page_serves_cached_first_page_without_network() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let key = cache::keys::ebooks_first(SortKey::Title.as_wire(), SortDir::Asc.as_wire(), "", "");
    cache::put_json(
        &key,
        &LibraryPage {
            path: None,
            books: vec![book("Cached Book")],
            next_cursor: None,
            total: Some(1),
            facets: None,
            hidden_count: None,
            stacks: Vec::new(),
        },
    );

    // Server unreachable, but the fresh cached first page short-circuits
    // before any network attempt.
    let page = get_ebooks_page(
        "http://127.0.0.1:1",
        SortKey::Title,
        SortDir::Asc,
        ViewFilters::default(),
        Vec::new(),
        None,
        10,
        false,
    )
    .await
    .expect("cached first page");
    assert_eq!(titles(&page), vec!["Cached Book"]);
    crate::offline::sync::note_online();
}

#[tokio::test]
async fn get_ebooks_page_falls_back_to_replica_when_the_first_fetch_dies() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    // Cold first-page cache (fresh unique sort axis), warm replica.
    cache::put_json(&cache::keys::ebooks_all(), &vec![book("Beloved")]);
    store::store()
        .expect("store")
        .kv_delete(&cache::keys::ebooks_first(
            SortKey::Author.as_wire(),
            SortDir::Desc.as_wire(),
            "",
            "",
        ));

    let page = get_ebooks_page(
        "http://127.0.0.1:1",
        SortKey::Author,
        SortDir::Desc,
        ViewFilters::default(),
        Vec::new(),
        None,
        10,
        false,
    )
    .await
    .expect("replica fallback");
    assert_eq!(titles(&page), vec!["Beloved"]);
    crate::offline::sync::note_online();
}

/// Serve `/api/ebooks` answering one book per name in `names`, titled with
/// that query value (`absent` when the request carried none).
async fn spawn_query_echo(names: &'static [&'static str]) -> String {
    use axum::extract::Query;
    use axum::routing::get;
    use axum::Json;
    use omnibus_shared::EbookLibrary;

    use crate::offline::test_support::spawn_router;

    let app = axum::Router::new().route(
        "/api/ebooks",
        get(
            move |Query(params): Query<std::collections::HashMap<String, String>>| async move {
                let books = names
                    .iter()
                    .map(|name| book(params.get(*name).map(String::as_str).unwrap_or("absent")))
                    .collect();
                Json(EbookLibrary {
                    path: None,
                    books,
                    error: None,
                    total: None,
                })
            },
        ),
    );
    spawn_router(app).await
}

#[tokio::test]
async fn get_ebooks_page_online_asks_the_server_to_omit_descriptions() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let base = spawn_query_echo(&["omit_description"]).await;

    let page = get_ebooks_page_online(
        &base,
        SortKey::Title,
        SortDir::Asc,
        ViewFilters::default(),
        Vec::new(),
        None,
        10,
    )
    .await
    .expect("page");

    assert_eq!(titles(&page), vec!["true"]);
}

#[tokio::test]
async fn get_ebooks_page_online_sends_the_filter_as_one_json_query_param() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let base = spawn_query_echo(&["filter", "formats"]).await;
    let filters = ViewFilters {
        clauses: vec![FilterClause {
            field: FilterField::Tag,
            mode: FilterMode::Exclude,
            values: vec!["a,b".into(), "c&d".into()],
        }],
        formats: vec!["epub".into()],
        ..Default::default()
    };

    let page = get_ebooks_page_online(
        &base,
        SortKey::Title,
        SortDir::Asc,
        filters,
        Vec::new(),
        None,
        10,
    )
    .await
    .expect("page");

    let sent: Vec<FilterClause> = serde_json::from_str(&titles(&page)[0]).expect("filter json");
    assert_eq!(
        sent,
        vec![
            FilterClause {
                field: FilterField::Format,
                mode: FilterMode::Include,
                values: vec!["epub".into()],
            },
            FilterClause {
                field: FilterField::Tag,
                mode: FilterMode::Exclude,
                values: vec!["a,b".into(), "c&d".into()],
            },
        ]
    );
    assert_eq!(titles(&page)[1], "absent", "no separate formats param");
}

#[tokio::test]
async fn get_ebooks_page_online_omits_the_filter_param_without_a_filter() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let base = spawn_query_echo(&["filter", "formats"]).await;

    let page = get_ebooks_page_online(
        &base,
        SortKey::Title,
        SortDir::Asc,
        ViewFilters::default(),
        Vec::new(),
        None,
        10,
    )
    .await
    .expect("page");

    assert_eq!(titles(&page), vec!["absent", "absent"]);
}

#[tokio::test]
async fn get_ebooks_page_serves_the_cached_first_page_only_for_the_filter_it_was_cached_under() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let base = spawn_query_echo(&["filter"]).await;
    let filters = ViewFilters {
        clauses: vec![FilterClause::new(
            FilterField::Tag,
            FilterMode::Include,
            &["horror"],
        )],
        ..Default::default()
    };
    // Series is an axis no other test caches, so the unfiltered key starts cold.
    let (sort, dir) = (SortKey::Series, SortDir::Asc);
    cache::put_json(
        &cache::keys::ebooks_first(
            sort.as_wire(),
            dir.as_wire(),
            &filters.to_query_param().unwrap(),
            "",
        ),
        &LibraryPage {
            path: None,
            books: vec![book("Cached Under Filter")],
            next_cursor: None,
            total: Some(1),
            facets: None,
            hidden_count: None,
            stacks: Vec::new(),
        },
    );
    store::store()
        .expect("store")
        .kv_delete(&cache::keys::ebooks_first(
            sort.as_wire(),
            dir.as_wire(),
            "",
            "",
        ));

    let filtered = get_ebooks_page(&base, sort, dir, filters, Vec::new(), None, 10, false)
        .await
        .expect("cached filtered page");
    let unfiltered = get_ebooks_page(
        &base,
        sort,
        dir,
        ViewFilters::default(),
        Vec::new(),
        None,
        10,
        false,
    )
    .await
    .expect("unfiltered page");

    assert_eq!(titles(&filtered), vec!["Cached Under Filter"]);
    assert_eq!(
        titles(&unfiltered),
        vec!["absent"],
        "the whole-library key was never cached, so the server answered"
    );
}
