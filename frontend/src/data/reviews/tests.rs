//! Mobile review transport tests: a patch reaches the wire field by field, and
//! an emptied review or a refusal reads back as what it is.

use std::sync::{Arc, Mutex};

use axum::http::StatusCode;
use axum::routing::{get, patch};
use axum::Json;

use crate::offline::test_support::spawn_router;

use super::*;

#[tokio::test]
async fn update_review_sends_a_cleared_field_as_null_and_reads_an_emptied_review_as_none() {
    let seen = Arc::new(Mutex::new(None::<serde_json::Value>));
    let record = seen.clone();
    let app = axum::Router::new().route(
        "/api/reviews/book-1",
        patch(move |Json(body): Json<serde_json::Value>| {
            let record = record.clone();
            async move {
                *record.lock().unwrap() = Some(body);
                Json(None::<Review>)
            }
        }),
    );
    let base_url = spawn_router(app).await;
    let clear_stars = ReviewPatch {
        stars: Some(None),
        ..Default::default()
    };

    let answer = update_review(&base_url, "book-1", clear_stars)
        .await
        .expect("an emptied review is not an error");

    assert_eq!(answer, None);
    // Text and notes were left out, so the server keeps them.
    assert_eq!(
        seen.lock().unwrap().clone(),
        Some(serde_json::json!({ "stars": null }))
    );
}

#[tokio::test]
async fn get_book_reviews_surfaces_a_missing_book_as_an_http_error() {
    let app = axum::Router::new().route(
        "/api/reviews/book-1",
        get(|| async { (StatusCode::NOT_FOUND, "book not found") }),
    );
    let base_url = spawn_router(app).await;

    match get_book_reviews(&base_url, "book-1").await {
        Err(DataError::Http { status, body }) => {
            assert_eq!(status, 404);
            assert_eq!(body, "book not found");
        }
        other => panic!("a missing book must stay an error: {other:?}"),
    }
}
