//! Tests for author listing and detail handlers.
use axum::{body::to_bytes, http::StatusCode};
use tower::ServiceExt;

use super::*;
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

#[tokio::test]
async fn api_get_author_returns_200_with_detail() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    // Seed a book with an author via replace_books.
    db::replace_books(
        &pool,
        "/lib",
        vec![db::ebook::IndexedBook {
            metadata: omnibus_shared::EbookMetadata {
                filename: "test.epub".into(),
                title: Some("Test Book".into()),
                creators: vec![omnibus_shared::Contributor {
                    name: "Jane Austen".into(),
                    role: Some("aut".into()),
                    file_as: Some("Austen, Jane".into()),
                    id: None,
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

    // Look up the author id from the DB.
    let author_id: i64 = sqlx::query_scalar("SELECT id FROM authors WHERE name = 'Jane Austen'")
        .fetch_one(&pool)
        .await
        .expect("author should exist");

    let response = app
        .oneshot(get_with_bearer(
            &format!("/api/authors/{author_id}"),
            &token,
        ))
        .await
        .expect("request should succeed");
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let detail: omnibus_shared::AuthorDetail = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(detail.name, "Jane Austen");
    assert_eq!(detail.book_count, 1);
    assert_eq!(detail.books.len(), 1);
    assert_eq!(detail.books[0].title.as_deref(), Some("Test Book"));
    assert!(
        detail.reading.is_empty(),
        "an unopened book carries no state"
    );
}

/// Seeds one book by Jane Austen under `/lib`, points settings at it, and has
/// `user` finish it. Returns the author id.
async fn seed_finished_austen(pool: &sqlx::SqlitePool, user: i64) -> i64 {
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
                filename: "emma.epub".into(),
                title: Some("Emma".into()),
                creators: vec![omnibus_shared::Contributor {
                    name: "Jane Austen".into(),
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
    let uuid: String = sqlx::query_scalar("SELECT uuid FROM books WHERE title = 'Emma'")
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
    sqlx::query_scalar("SELECT id FROM authors WHERE name = 'Jane Austen'")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn api_get_author_carries_the_callers_reading_state() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let author_id = seed_finished_austen(&pool, user.id).await;

    let response = app
        .oneshot(get_with_bearer(
            &format!("/api/authors/{author_id}"),
            &token,
        ))
        .await
        .unwrap();

    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let detail: omnibus_shared::AuthorDetail = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(detail.reading.len(), 1);
    assert_eq!(
        detail.reading[0].status,
        omnibus_shared::ReadStatus::Finished
    );
}

#[tokio::test]
async fn api_get_author_reading_returns_the_callers_counts() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let author_id = seed_finished_austen(&pool, user.id).await;

    let response = app
        .oneshot(get_with_bearer("/api/authors/reading", &token))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let rows: Vec<omnibus_shared::AuthorReading> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (rows[0].author_id, rows[0].finished, rows[0].reading),
        (author_id, 1, 0)
    );
}

#[tokio::test]
async fn api_get_author_reading_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;
    let res = app.oneshot(get_anon("/api/authors/reading")).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_author_returns_404_for_unknown_id() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let response = app
        .oneshot(get_with_bearer("/api/authors/9999", &token))
        .await
        .expect("request should succeed");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_get_author_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;
    let res = app.oneshot(get_anon("/api/authors/1")).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

// -------------------------------------------------------------------
// F1.12 — /api/authors index endpoint.
// -------------------------------------------------------------------

#[tokio::test]
async fn api_get_authors_index_returns_summaries_scoped_to_library() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    // Point settings at /lib and seed two books with distinct authors.
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
        vec![
            db::ebook::IndexedBook {
                metadata: omnibus_shared::EbookMetadata {
                    filename: "a.epub".into(),
                    title: Some("A".into()),
                    creators: vec![omnibus_shared::Contributor {
                        name: "Aaron Albright".into(),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                cover: None,
                mtime_epoch: 0,
                size_bytes: 0,
                word_count: None,
            },
            db::ebook::IndexedBook {
                metadata: omnibus_shared::EbookMetadata {
                    filename: "b.epub".into(),
                    title: Some("B".into()),
                    creators: vec![omnibus_shared::Contributor {
                        name: "Zelda Zinn".into(),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                cover: None,
                mtime_epoch: 0,
                size_bytes: 0,
                word_count: None,
            },
        ],
    )
    .await
    .unwrap();

    let response = app
        .oneshot(get_with_bearer("/api/authors", &token))
        .await
        .expect("request should succeed");
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let authors: Vec<omnibus_shared::AuthorSummary> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(authors.len(), 2);
    let names: Vec<_> = authors.iter().map(|a| a.name.clone()).collect();
    assert_eq!(
        names,
        vec!["Aaron Albright".to_string(), "Zelda Zinn".to_string()],
        "expected alpha order"
    );
    for a in &authors {
        assert_eq!(a.book_count, 1);
    }
}

#[tokio::test]
async fn api_get_authors_index_returns_empty_when_no_library_configured() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let response = app
        .oneshot(get_with_bearer("/api/authors", &token))
        .await
        .expect("request should succeed");
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let authors: Vec<omnibus_shared::AuthorSummary> = serde_json::from_slice(&bytes).unwrap();
    assert!(authors.is_empty());
}

#[tokio::test]
async fn api_get_authors_index_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;
    let res = app.oneshot(get_anon("/api/authors")).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_author_returns_500_when_reading_state_cannot_be_read() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let author_id = seed_finished_austen(&pool, user.id).await;
    sqlx::query("DROP TABLE book_read_status")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/authors/{author_id}"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn api_get_author_reading_returns_500_when_reading_state_cannot_be_read() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    seed_finished_austen(&pool, user.id).await;
    sqlx::query("DROP TABLE book_read_status")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer("/api/authors/reading", &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

fn delete_author_request(id: i64, token: &str) -> axum::http::Request<axum::body::Body> {
    axum::http::Request::builder()
        .uri(format!("/api/authors/{id}"))
        .method("DELETE")
        .header(axum::http::header::AUTHORIZATION, format!("Bearer {token}"))
        .body(axum::body::Body::empty())
        .unwrap()
}

#[tokio::test]
async fn api_delete_author_removes_the_author_and_ignores_the_name_when_admin() {
    let (app, _state, pool) = fixture().await;
    let id = seed_author(&pool, "Ada Lovelace").await;
    let admin = auth_test_support::create_admin(&pool, "admin").await;
    let token = auth_test_support::bearer_token(&pool, admin.id).await;

    let res = app
        .oneshot(delete_author_request(id, &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM authors WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
    let ignored: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM ignored_authors WHERE name = 'Ada Lovelace'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(ignored, 1);
}

#[tokio::test]
async fn api_delete_author_returns_403_and_keeps_the_author_when_not_admin() {
    let (app, _state, pool) = fixture().await;
    let id = seed_author(&pool, "Ada Lovelace").await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(delete_author_request(id, &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM authors WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 1);
}

#[tokio::test]
async fn api_delete_author_returns_204_for_unknown_id() {
    let (app, _state, pool) = fixture().await;
    let admin = auth_test_support::create_admin(&pool, "admin").await;
    let token = auth_test_support::bearer_token(&pool, admin.id).await;

    let res = app
        .oneshot(delete_author_request(9999, &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn api_delete_author_returns_500_when_the_author_cannot_be_deleted() {
    let (app, _state, pool) = fixture().await;
    let id = seed_author(&pool, "Ada Lovelace").await;
    let admin = auth_test_support::create_admin(&pool, "admin").await;
    let token = auth_test_support::bearer_token(&pool, admin.id).await;
    sqlx::query("DROP TABLE ignored_authors")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(delete_author_request(id, &token))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
