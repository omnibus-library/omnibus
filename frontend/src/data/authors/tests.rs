//! Mobile `get_author_online` tests: a 404 reads as no author, any other failure stays an error.

use axum::http::StatusCode;
use axum::routing::get;
use axum::Json;

use crate::offline::test_support::spawn_router;

use super::*;

#[tokio::test]
async fn get_author_online_returns_the_author_when_found() {
    let app = axum::Router::new().route(
        "/api/authors/7",
        get(|| async {
            Json(AuthorDetail {
                id: 7,
                name: "Ursula K. Le Guin".into(),
                ..Default::default()
            })
        }),
    );
    let base_url = spawn_router(app).await;

    let author = get_author_online(&base_url, 7)
        .await
        .expect("a found author is not an error")
        .expect("a 200 carries the author");

    assert_eq!(author.id, 7);
    assert_eq!(author.name, "Ursula K. Le Guin");
}

#[tokio::test]
async fn get_author_online_reads_a_404_as_none() {
    let app = axum::Router::new().route(
        "/api/authors/7",
        get(|| async { (StatusCode::NOT_FOUND, "no such author") }),
    );
    let base_url = spawn_router(app).await;

    let author = get_author_online(&base_url, 7)
        .await
        .expect("a missing author is not an error");

    assert_eq!(author, None);
}

#[tokio::test]
async fn get_author_online_surfaces_other_failures_as_http_errors() {
    let app = axum::Router::new().route(
        "/api/authors/7",
        get(|| async { (StatusCode::INTERNAL_SERVER_ERROR, "db locked") }),
    );
    let base_url = spawn_router(app).await;

    match get_author_online(&base_url, 7).await {
        Err(DataError::Http { status, body }) => {
            assert_eq!(status, 500);
            assert_eq!(body, "db locked");
        }
        other => panic!("a 500 must not read as a missing author: {other:?}"),
    }
}
