//! Mobile `remove_wishlist_entry` tests: every body shape a server answers with reads as a removal result.

use axum::http::StatusCode;
use axum::routing::delete;
use axum::Json;

use crate::offline::test_support::spawn_router;

use super::*;

#[tokio::test]
async fn remove_wishlist_entry_reads_whether_the_book_went_with_it() {
    let app = axum::Router::new().route(
        "/api/physical/b-1/wishlist",
        delete(|| async { Json(WishlistRemoval { book_deleted: true }) }),
    );
    let base_url = spawn_router(app).await;

    let removal = remove_wishlist_entry(&base_url, "b-1")
        .await
        .expect("a JSON answer is a removal result");

    assert_eq!(removal, WishlistRemoval { book_deleted: true });
}

#[tokio::test]
async fn remove_wishlist_entry_reads_an_older_servers_bare_204_as_book_kept() {
    let app = axum::Router::new().route(
        "/api/physical/b-1/wishlist",
        delete(|| async { StatusCode::NO_CONTENT }),
    );
    let base_url = spawn_router(app).await;

    let removal = remove_wishlist_entry(&base_url, "b-1")
        .await
        .expect("an empty body is not an error");

    assert_eq!(removal, WishlistRemoval::default());
}

#[tokio::test]
async fn remove_wishlist_entry_reports_a_malformed_body_as_a_decode_error() {
    let app = axum::Router::new().route(
        "/api/physical/b-1/wishlist",
        delete(|| async { (StatusCode::OK, "not json") }),
    );
    let base_url = spawn_router(app).await;

    match remove_wishlist_entry(&base_url, "b-1").await {
        Err(DataError::Decode(_)) => {}
        other => panic!("a garbled body must not read as a removal: {other:?}"),
    }
}
