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

/// Seeds "Dune" as book 1 of "Dune Chronicles" under `/lib` and has `user`
/// finish it. Returns the series id.
async fn seed_finished_dune(pool: &sqlx::SqlitePool, user: i64) -> i64 {
    let dune = omnibus_shared::EbookMetadata {
        filename: "dune.epub".into(),
        title: Some("Dune".into()),
        series: Some("Dune Chronicles".into()),
        series_index: Some("1".into()),
        ..Default::default()
    };
    seed_finished_book(pool, user, dune).await;
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

async fn series_detail(
    app: axum::Router,
    series_id: i64,
    token: &str,
) -> omnibus_shared::SeriesDetail {
    let response = app
        .oneshot(get_with_bearer(&format!("/api/series/{series_id}"), token))
        .await
        .unwrap();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn api_series_hide_flags_the_series_for_the_caller_until_it_is_shown_again() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let series_id = seed_finished_dune(&pool, user.id).await;
    let uri = format!("/api/series/{series_id}/hide");

    let put = app
        .clone()
        .oneshot(request("PUT", &uri, Some(&token), None))
        .await
        .unwrap();
    assert_eq!(put.status(), StatusCode::NO_CONTENT);
    assert!(
        series_detail(app.clone(), series_id, &token)
            .await
            .hidden_from_home
    );

    let delete = app
        .clone()
        .oneshot(request("DELETE", &uri, Some(&token), None))
        .await
        .unwrap();
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);
    assert!(!series_detail(app, series_id, &token).await.hidden_from_home);
}

#[tokio::test]
async fn api_series_hide_does_not_flag_the_series_for_another_reader() {
    let (app, _state, pool) = fixture().await;
    let alice = auth_test_support::create_user(&pool, "alice").await;
    let bob = auth_test_support::create_user(&pool, "bob").await;
    let alice_token = auth_test_support::bearer_token(&pool, alice.id).await;
    let bob_token = auth_test_support::bearer_token(&pool, bob.id).await;
    let series_id = seed_finished_dune(&pool, alice.id).await;

    app.clone()
        .oneshot(request(
            "PUT",
            &format!("/api/series/{series_id}/hide"),
            Some(&alice_token),
            None,
        ))
        .await
        .unwrap();

    assert!(
        !series_detail(app, series_id, &bob_token)
            .await
            .hidden_from_home
    );
}

#[tokio::test]
async fn api_series_hide_returns_404_for_an_unknown_series() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    for method in ["PUT", "DELETE"] {
        let res = app
            .clone()
            .oneshot(request(method, "/api/series/9999/hide", Some(&token), None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "{method}");
        assert_eq!(body_text(res).await, "No series has that id.", "{method}");
    }
}

#[tokio::test]
async fn api_series_hide_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;
    for method in ["PUT", "DELETE"] {
        let res = app
            .clone()
            .oneshot(request(method, "/api/series/1/hide", None, None))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{method}");
    }
}

#[tokio::test]
async fn api_get_series_returns_500_when_the_hide_cannot_be_read() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let series_id = seed_finished_dune(&pool, user.id).await;
    sqlx::query("DROP TABLE series_hides")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer(&format!("/api/series/{series_id}"), &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

/// Seeds the two Saga books under `/lib` and has `user` finish the first.
async fn seed_saga_started(pool: &sqlx::SqlitePool, user: i64) -> (i64, String) {
    use db::test_support::{indexed, mark_status, series_id_by_name, uuid_by_title};

    set_library_paths(pool, Some("/lib"), None).await;
    let saga =
        |file, title, index| indexed(file, Some(title), &[], &[], Some(("Saga", index)), None);
    db::replace_books(
        pool,
        "/lib",
        vec![saga("one.epub", "One", "1"), saga("two.epub", "Two", "2")],
    )
    .await
    .unwrap();
    let one = uuid_by_title(pool, "One").await;
    mark_status(pool, user, &one, omnibus_shared::ReadStatus::Finished).await;
    (
        series_id_by_name(pool, "Saga").await,
        uuid_by_title(pool, "Two").await,
    )
}

async fn in_progress_rows(app: axum::Router, token: &str) -> Vec<omnibus_shared::SeriesInProgress> {
    let res = app
        .oneshot(get_with_bearer("/api/series/in-progress", token))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    body_json(res).await
}

#[tokio::test]
async fn api_get_series_in_progress_returns_the_callers_rows_with_the_next_book() {
    let (app, _state, pool) = fixture().await;
    let alice = auth_test_support::create_user(&pool, "alice").await;
    let bob = auth_test_support::create_user(&pool, "bob").await;
    let alice_token = auth_test_support::bearer_token(&pool, alice.id).await;
    let bob_token = auth_test_support::bearer_token(&pool, bob.id).await;
    let (series_id, two) = seed_saga_started(&pool, alice.id).await;

    let rows = in_progress_rows(app.clone(), &alice_token).await;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].series.id, series_id);
    assert_eq!(rows[0].next_book_uuid, two);
    assert!(in_progress_rows(app, &bob_token).await.is_empty());
}

#[tokio::test]
async fn api_get_series_in_progress_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;
    let res = app
        .oneshot(get_anon("/api/series/in-progress"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_series_in_progress_returns_500_when_reading_state_cannot_be_read() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    seed_saga_started(&pool, user.id).await;
    sqlx::query("DROP TABLE book_read_status")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer("/api/series/in-progress", &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn api_starting_a_new_book_of_a_hidden_series_lists_it_in_progress_again() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (series_id, two) = seed_saga_started(&pool, user.id).await;
    app.clone()
        .oneshot(request(
            "PUT",
            &format!("/api/series/{series_id}/hide"),
            Some(&token),
            None,
        ))
        .await
        .unwrap();
    assert!(in_progress_rows(app.clone(), &token).await.is_empty());

    let position = serde_json::json!({
        "book_uuid": two,
        "format": "epub",
        "epub_cfi": "epubcfi(/6/4!/4/2/1:0)",
        "progress_percent": 5,
    });
    let saved = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/progress",
            Some(&token),
            Some(position),
        ))
        .await
        .unwrap();
    assert_eq!(saved.status(), StatusCode::OK);

    let rows = in_progress_rows(app, &token).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].series.id, series_id);
    assert_eq!(rows[0].next_book_uuid, two);
}

#[tokio::test]
async fn api_series_hide_returns_500_when_the_hide_cannot_be_written() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let series_id = seed_finished_dune(&pool, user.id).await;
    sqlx::query("DROP TABLE series_hides")
        .execute(&pool)
        .await
        .unwrap();

    for method in ["PUT", "DELETE"] {
        let res = app
            .clone()
            .oneshot(request(
                method,
                &format!("/api/series/{series_id}/hide"),
                Some(&token),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR, "{method}");
    }
}
