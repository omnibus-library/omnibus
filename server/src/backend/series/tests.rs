//! Tests for series listing, detail and per-reader progress handlers.
use axum::{body::to_bytes, http::StatusCode};
use tower::ServiceExt;

use super::*;
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

#[tokio::test]
async fn api_get_series_returns_200_with_detail() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    // Seed a book with a series.
    db::replace_books(
        &pool,
        "/lib",
        vec![db::ebook::IndexedBook {
            metadata: omnibus_shared::EbookMetadata {
                filename: "series-book.epub".into(),
                title: Some("Dune".into()),
                series: Some("Dune Chronicles".into()),
                series_index: Some("1".into()),
                ..Default::default()
            },
            cover: None,
            mtime_epoch: 0,
            size_bytes: 0,
            word_count: None,
        }],
    )
    .await
    .unwrap();

    let series_id: i64 = sqlx::query_scalar("SELECT id FROM series WHERE name = 'Dune Chronicles'")
        .fetch_one(&pool)
        .await
        .expect("series should exist");

    let response = app
        .oneshot(get_with_bearer(&format!("/api/series/{series_id}"), &token))
        .await
        .expect("request should succeed");
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let detail: omnibus_shared::SeriesDetail = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(detail.name, "Dune Chronicles");
    assert_eq!(detail.book_count, 1);
    assert_eq!(detail.books.len(), 1);
    assert_eq!(detail.books[0].title.as_deref(), Some("Dune"));
}

#[tokio::test]
async fn api_get_series_returns_404_for_unknown_id() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let response = app
        .oneshot(get_with_bearer("/api/series/9999", &token))
        .await
        .expect("request should succeed");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_get_series_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;
    let res = app.oneshot(get_anon("/api/series/1")).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

// -------------------------------------------------------------------
// F1.12 — /api/series index endpoint.
// -------------------------------------------------------------------

#[tokio::test]
async fn api_get_series_index_returns_summaries_with_primary_author() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    db::set_settings(
        &pool,
        &omnibus_shared::Settings {
            ebook_library_path: Some("/lib".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db::replace_books(
        &pool,
        "/lib",
        vec![db::ebook::IndexedBook {
            metadata: omnibus_shared::EbookMetadata {
                filename: "dune.epub".into(),
                title: Some("Dune".into()),
                series: Some("Dune Chronicles".into()),
                series_index: Some("1".into()),
                creators: vec![omnibus_shared::Contributor {
                    name: "Frank Herbert".into(),
                    ..Default::default()
                }],
                ..Default::default()
            },
            cover: None,
            mtime_epoch: 0,
            size_bytes: 0,
            word_count: None,
        }],
    )
    .await
    .unwrap();

    let response = app
        .oneshot(get_with_bearer("/api/series", &token))
        .await
        .expect("request should succeed");
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let series: Vec<omnibus_shared::SeriesSummary> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(series.len(), 1);
    assert_eq!(series[0].name, "Dune Chronicles");
    assert_eq!(series[0].book_count, 1);
    assert_eq!(series[0].primary_author.as_deref(), Some("Frank Herbert"));
}

#[tokio::test]
async fn api_get_series_index_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;
    let res = app.oneshot(get_anon("/api/series")).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

/// Seeds "Dune" as book 1 of "Dune Chronicles" under a configured `/lib`,
/// marks it finished for `user`, and returns the series id.
async fn seed_finished_dune(pool: &sqlx::SqlitePool, user: i64) -> i64 {
    db::set_settings(
        pool,
        &omnibus_shared::Settings {
            ebook_library_path: Some("/lib".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    db::replace_books(
        pool,
        "/lib",
        vec![db::ebook::IndexedBook {
            metadata: omnibus_shared::EbookMetadata {
                filename: "dune.epub".into(),
                title: Some("Dune".into()),
                series: Some("Dune Chronicles".into()),
                series_index: Some("1".into()),
                ..Default::default()
            },
            cover: None,
            mtime_epoch: 0,
            size_bytes: 0,
            word_count: None,
        }],
    )
    .await
    .unwrap();
    let uuid: String = sqlx::query_scalar("SELECT uuid FROM books WHERE title = 'Dune'")
        .fetch_one(pool)
        .await
        .unwrap();
    db::read_status::set_read_status(
        pool,
        user,
        &omnibus_shared::SetReadStatus {
            book_uuid: uuid,
            status: omnibus_shared::ReadStatus::Finished,
        },
    )
    .await
    .unwrap();
    sqlx::query_scalar("SELECT id FROM series WHERE name = 'Dune Chronicles'")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn api_get_series_carries_the_callers_reading_state() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let series_id = seed_finished_dune(&pool, user.id).await;

    let response = app
        .oneshot(get_with_bearer(&format!("/api/series/{series_id}"), &token))
        .await
        .unwrap();

    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let detail: omnibus_shared::SeriesDetail = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(detail.reading.len(), 1);
    assert_eq!(
        detail.reading[0].status,
        omnibus_shared::ReadStatus::Finished
    );
}

#[tokio::test]
async fn api_get_series_returns_500_when_reading_state_cannot_be_read() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let series_id = seed_finished_dune(&pool, user.id).await;
    sqlx::query("DROP TABLE book_read_status")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer(&format!("/api/series/{series_id}"), &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn api_get_series_reading_returns_the_callers_counts() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let series_id = seed_finished_dune(&pool, user.id).await;

    let response = app
        .oneshot(get_with_bearer("/api/series/reading", &token))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let rows: Vec<omnibus_shared::SeriesReading> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (rows[0].series_id, rows[0].finished, rows[0].reading),
        (series_id, 1, 0)
    );
}

#[tokio::test]
async fn api_get_series_reading_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;
    let res = app.oneshot(get_anon("/api/series/reading")).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_series_reading_returns_500_when_reading_state_cannot_be_read() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    seed_finished_dune(&pool, user.id).await;
    sqlx::query("DROP TABLE book_read_status")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer("/api/series/reading", &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
