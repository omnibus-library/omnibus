//! `load_options` against a stub server: each field must read its own
//! endpoint, so a mis-wired source answers 404 and fails here.

// The state-lock guard is deliberately held across awaits: it serializes
// whole async test bodies against process-global state, and each test owns
// its own thread + runtime, so there is no interleaving to deadlock on.
#![allow(clippy::await_holding_lock)]

use axum::routing::get;
use axum::{Json, Router};
use omnibus_shared::{SeriesSummary, ShelfKind, ShelfSummary, TagWeight, Visibility};

use crate::offline::store;
use crate::offline::sync::{note_online, test_state_lock};
use crate::offline::test_support::spawn_router;

use super::*;

fn option(value: &str, label: &str, count: usize) -> FilterOption {
    FilterOption {
        value: value.to_string(),
        label: label.to_string(),
        count: Some(count),
    }
}

fn shelf(id: i64, name: &str, owner_user_id: i64, owner: &str) -> ShelfSummary {
    ShelfSummary {
        id,
        owner_user_id,
        owner_username: owner.to_string(),
        owner_has_avatar: false,
        kind: ShelfKind::Manual,
        name: name.to_string(),
        visibility: Visibility::Public,
        accent: None,
        book_count: 2,
        cover_uuids: Vec::new(),
    }
}

/// A stub server whose only route is `path`, answering `body`.
async fn serve_only<T>(path: &str, body: T) -> String
where
    T: serde::Serialize + Clone + Send + Sync + 'static,
{
    let route = get(move || {
        let body = body.clone();
        async move { Json(body) }
    });
    spawn_router(Router::new().route(path, route)).await
}

#[tokio::test]
async fn load_options_returns_the_known_formats_for_the_format_field_without_asking_the_server() {
    let unreachable = "http://127.0.0.1:1";

    let list = load_options(unreachable, FilterField::Format, None)
        .await
        .expect("formats need no server");

    assert_eq!(list, OptionList::new(format_options()));
}

#[tokio::test]
async fn load_options_reads_tag_options_from_the_tag_cloud() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    note_online();
    let tags = vec![TagWeight {
        name: "Sci-Fi".to_string(),
        count: 4,
    }];
    let base = serve_only("/api/tags", tags).await;

    let list = load_options(&base, FilterField::Tag, None)
        .await
        .expect("tag options");

    assert_eq!(list, OptionList::new(vec![option("Sci-Fi", "Sci-Fi", 4)]));
}

#[tokio::test]
async fn load_options_reads_series_options_from_the_series_index() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    note_online();
    let series = vec![SeriesSummary {
        id: 3,
        name: "Pioneers".to_string(),
        book_count: 5,
        ..Default::default()
    }];
    let base = serve_only("/api/series", series).await;

    let list = load_options(&base, FilterField::Series, None)
        .await
        .expect("series options");

    assert_eq!(
        list,
        OptionList::new(vec![option("Pioneers", "Pioneers", 5)])
    );
}

#[tokio::test]
async fn load_options_names_the_owner_of_another_readers_shelf() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    note_online();
    let shelves = vec![
        shelf(4, "Favourites", 1, "me"),
        shelf(5, "Favourites", 2, "alice"),
    ];
    let base = serve_only("/api/shelves", shelves).await;

    let list = load_options(&base, FilterField::Shelf, Some(1))
        .await
        .expect("shelf options");

    let expected = vec![
        option("4", "Favourites", 2),
        option("5", "Favourites \u{b7} alice", 2),
    ];
    assert_eq!(list, OptionList::new(expected));
}

#[tokio::test]
async fn load_options_surfaces_a_failed_read_as_an_error() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    note_online();
    let base = spawn_router(Router::new()).await;

    let result = load_options(&base, FilterField::Genre, None).await;

    assert!(result.is_err(), "a 404 must not read as an empty list");
}
