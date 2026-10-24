//! Mobile check-in writes outdate the cached shelves: a copy or wish that lands
//! changes what a shelf holds, and the shelf page would otherwise serve its
//! fresh copy for the cache window. A write that fails changes nothing.

// The state-lock guard is deliberately held across awaits: it serializes whole
// async test bodies against process-global state, and each test owns its own
// thread + runtime, so there is no interleaving to deadlock on.
#![allow(clippy::await_holding_lock)]

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::Json;
use omnibus_shared::{AddPhysicalOnlyRequest, ExternalBookMeta, MetadataProvider, WishlistSource};

use crate::offline::store;
use crate::offline::sync::test_state_lock;
use crate::offline::test_support::spawn_router;

use super::*;

const SHELF_ROWS: [&str; 3] = ["shelves", "shelf:3", "shelf_page:3:title:asc:f="];

async fn fetched_at(key: &str) -> i64 {
    let st = store::store().expect("store");
    st.kv_get(key).await.expect("row kept").fetched_at
}

/// A server answering `path` with `answer`, and a store holding a fresh row for
/// every shelf key plus an unrelated one.
async fn server_and_cached_rows(path: &str, answer: StatusCode) -> String {
    store::init_global_for_tests();
    let st = store::store().expect("test store");
    for key in SHELF_ROWS.iter().copied().chain(["stats:month"]) {
        st.kv_put(key, "{}".to_string());
    }
    let app = axum::Router::new().route(
        path,
        post(move || async move {
            if answer.is_success() {
                Json(BookRef {
                    book_uuid: "u".into(),
                })
                .into_response()
            } else {
                (answer, "refused").into_response()
            }
        }),
    );
    spawn_router(app).await
}

fn meta() -> ExternalBookMeta {
    ExternalBookMeta {
        isbn13: "9780441013593".into(),
        title: "Dune".into(),
        authors: vec!["Frank Herbert".into()],
        year: None,
        pages: None,
        publisher: None,
        description: None,
        cover_url: None,
        series: None,
        first_publish_year: None,
        format: None,
        source: MetadataProvider::OpenLibrary,
    }
}

async fn assert_shelves_stale_and_the_rest_fresh() {
    for key in SHELF_ROWS {
        assert_eq!(fetched_at(key).await, 0, "{key} must read as stale");
    }
    assert!(fetched_at("stats:month").await > 0);
}

#[tokio::test]
async fn check_in_outdates_every_cached_shelf_row_once_it_lands() {
    let _guard = test_state_lock().lock().unwrap();
    let base = server_and_cached_rows("/api/scan/check-in", StatusCode::OK).await;

    check_in(
        &base,
        CheckInRequest {
            book_uuid: "u".into(),
            isbn: None,
            note: None,
        },
    )
    .await
    .unwrap();

    assert_shelves_stale_and_the_rest_fresh().await;
}

#[tokio::test]
async fn add_physical_only_outdates_every_cached_shelf_row_once_it_lands() {
    let _guard = test_state_lock().lock().unwrap();
    let base = server_and_cached_rows("/api/scan/physical-only", StatusCode::OK).await;

    add_physical_only(
        &base,
        AddPhysicalOnlyRequest {
            meta: meta(),
            note: None,
        },
    )
    .await
    .unwrap();

    assert_shelves_stale_and_the_rest_fresh().await;
}

#[tokio::test]
async fn wishlist_add_outdates_every_cached_shelf_row_once_it_lands() {
    let _guard = test_state_lock().lock().unwrap();
    let base = server_and_cached_rows("/api/scan/wishlist", StatusCode::OK).await;

    wishlist_add(
        &base,
        WishlistAddRequest {
            book_uuid: Some("u".into()),
            meta: None,
            source: WishlistSource::Scan,
        },
    )
    .await
    .unwrap();

    assert_shelves_stale_and_the_rest_fresh().await;
}

#[tokio::test]
async fn a_failed_wishlist_add_leaves_the_cached_shelf_rows_fresh() {
    let _guard = test_state_lock().lock().unwrap();
    let base =
        server_and_cached_rows("/api/scan/wishlist", StatusCode::INTERNAL_SERVER_ERROR).await;

    let result = wishlist_add(
        &base,
        WishlistAddRequest {
            book_uuid: Some("u".into()),
            meta: None,
            source: WishlistSource::Scan,
        },
    )
    .await;

    assert!(result.is_err());
    for key in SHELF_ROWS {
        assert!(fetched_at(key).await > 0, "{key} must stay fresh");
    }
}
