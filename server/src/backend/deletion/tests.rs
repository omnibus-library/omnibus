//! Tests for the admin deletion REST endpoints: auth + admin gate, the
//! manifest's contents, the partial and total delete round-trips, and the
//! per-variant 4xx mappings.

use axum::{
    body::{to_bytes, Body},
    http::{header::AUTHORIZATION, Request, StatusCode},
};
use omnibus_shared::{BookDeletionManifest, DeleteBookFilesResult};
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

use omnibus_db as db;

/// POST `body` as JSON with a bearer header.
fn post_json(uri: &str, token: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .method("POST")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn body_json<T: serde::de::DeserializeOwned>(res: axum::response::Response) -> T {
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// A book with one `book_files` row (the seed path writes one per indexed
/// file) and one physical copy, so a manifest lists both item kinds.
async fn seed_book_with_file_and_copy(pool: &sqlx::SqlitePool) -> (String, i64, i64) {
    let (book_id, uuid) = seed_book_with_uuid(pool, "/lib-a", "Doomed Book").await;
    let file_id: i64 = sqlx::query_scalar("SELECT id FROM book_files WHERE book_id = ?")
        .bind(book_id)
        .fetch_one(pool)
        .await
        .unwrap();
    let copy = db::add_physical_copy(pool, &uuid, None, None, None)
        .await
        .unwrap();
    (uuid, file_id, copy.id)
}

async fn admin_token(pool: &sqlx::SqlitePool) -> String {
    let admin = auth_test_support::create_admin(pool, "root").await;
    auth_test_support::bearer_token(pool, admin.id).await
}

async fn books_row_count(pool: &sqlx::SqlitePool, uuid: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM books WHERE uuid = ?")
        .bind(uuid)
        .fetch_one(pool)
        .await
        .unwrap()
}

// --- manifest ---------------------------------------------------------------

#[tokio::test]
async fn api_deletion_manifest_requires_auth() {
    let (app, _state, pool) = fixture().await;
    let (uuid, _, _) = seed_book_with_file_and_copy(&pool).await;
    let res = app
        .oneshot(get_anon(&format!("/api/books/{uuid}/deletion-manifest")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_deletion_manifest_rejects_a_non_admin_user() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (uuid, _, _) = seed_book_with_file_and_copy(&pool).await;
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/deletion-manifest"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn api_deletion_manifest_lists_the_books_files_and_copies() {
    let (app, _state, pool) = fixture().await;
    let admin = auth_test_support::create_admin(&pool, "root").await;
    let token = auth_test_support::bearer_token(&pool, admin.id).await;
    let (uuid, file_id, copy_id) = seed_book_with_file_and_copy(&pool).await;
    // One highlight and one rating, so the manifest's hand-mapped impact
    // counters are pinned against the tables that actually back them
    // (annotations -> highlights, user_ratings -> ratings) rather than just
    // asserted zero.
    sqlx::query(
        "INSERT INTO annotations (user_id, book_uuid, epub_cfi_range, created_at)
         VALUES (?1, ?2, 'x', 1)",
    )
    .bind(admin.id)
    .bind(&uuid)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO user_ratings (user_id, book_uuid, half_stars, updated_at)
         VALUES (?1, ?2, 8, 1)",
    )
    .bind(admin.id)
    .bind(&uuid)
    .execute(&pool)
    .await
    .unwrap();
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/deletion-manifest"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let manifest: BookDeletionManifest = body_json(res).await;
    assert_eq!(
        manifest.files.iter().map(|f| f.id).collect::<Vec<_>>(),
        vec![file_id]
    );
    assert_eq!(
        manifest.copies.iter().map(|c| c.id).collect::<Vec<_>>(),
        vec![copy_id]
    );
    assert_eq!(manifest.item_count(), 2);
    assert_eq!(manifest.impact.highlights, 1);
    assert_eq!(manifest.impact.ratings, 1);
    assert_eq!(manifest.impact.journal_entries, 0);
    assert_eq!(manifest.impact.bookmarks, 0);
    assert_eq!(manifest.impact.reading_sessions, 0);
    assert_eq!(manifest.impact.listening_sessions, 0);
    assert_eq!(manifest.impact.shelves, 0);
}

#[tokio::test]
async fn api_deletion_manifest_404s_for_an_unknown_book() {
    let (app, _state, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let res = app
        .oneshot(get_with_bearer(
            "/api/books/no-such-book/deletion-manifest",
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_deletion_manifest_500s_when_the_db_is_gone() {
    let (app, _state, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let (uuid, _, _) = seed_book_with_file_and_copy(&pool).await;
    sqlx::query("DROP TABLE annotations")
        .execute(&pool)
        .await
        .unwrap();
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/deletion-manifest"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

// --- delete -----------------------------------------------------------------

#[tokio::test]
async fn api_delete_book_files_requires_auth() {
    let (app, _state, pool) = fixture().await;
    let (uuid, file_id, _) = seed_book_with_file_and_copy(&pool).await;
    let res = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/books/{uuid}/delete-files"))
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "file_ids": [file_id] }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_delete_book_files_rejects_a_non_admin_user() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (uuid, file_id, _) = seed_book_with_file_and_copy(&pool).await;
    let res = app
        .oneshot(post_json(
            &format!("/api/books/{uuid}/delete-files"),
            &token,
            serde_json::json!({ "file_ids": [file_id] }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    // The gate rejected before the transaction: the book survives intact.
    assert_eq!(books_row_count(&pool, &uuid).await, 1);
}

#[tokio::test]
async fn api_delete_book_files_removes_one_item_and_keeps_the_book() {
    let (app, _state, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let (uuid, file_id, copy_id) = seed_book_with_file_and_copy(&pool).await;
    let res = app
        .oneshot(post_json(
            &format!("/api/books/{uuid}/delete-files"),
            &token,
            serde_json::json!({ "file_ids": [file_id], "copy_ids": [] }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let out: DeleteBookFilesResult = body_json(res).await;
    assert_eq!(out.deleted_file_ids, vec![file_id]);
    assert!(out.deleted_copy_ids.is_empty());
    assert!(!out.book_deleted);
    // The copy is the item left behind, so the record stays.
    assert_eq!(books_row_count(&pool, &uuid).await, 1);
    let copies = db::list_physical_copies(&pool, &uuid).await.unwrap();
    assert_eq!(
        copies.iter().map(|c| c.id).collect::<Vec<_>>(),
        vec![copy_id]
    );
}

#[tokio::test]
async fn api_delete_book_files_removes_the_book_when_every_item_goes() {
    let (app, _state, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let (uuid, file_id, copy_id) = seed_book_with_file_and_copy(&pool).await;
    let res = app
        .oneshot(post_json(
            &format!("/api/books/{uuid}/delete-files"),
            &token,
            serde_json::json!({ "file_ids": [file_id], "copy_ids": [copy_id] }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let out: DeleteBookFilesResult = body_json(res).await;
    assert!(out.book_deleted);
    assert_eq!(books_row_count(&pool, &uuid).await, 0);
}

#[tokio::test]
async fn api_delete_book_files_404s_for_an_unknown_book() {
    let (app, _state, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let res = app
        .oneshot(post_json(
            "/api/books/no-such-book/delete-files",
            &token,
            serde_json::json!({ "file_ids": [1] }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_delete_book_files_422s_when_an_item_belongs_to_another_book() {
    let (app, _state, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let (uuid, file_id, _) = seed_book_with_file_and_copy(&pool).await;
    let (_, other_uuid) = seed_book_with_uuid(&pool, "/lib-b", "Other Book").await;
    let res = app
        .oneshot(post_json(
            &format!("/api/books/{other_uuid}/delete-files"),
            &token,
            serde_json::json!({ "file_ids": [file_id] }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    // Nothing moved: the file's own book still has it.
    assert_eq!(books_row_count(&pool, &uuid).await, 1);
    let manifest = db::book_deletion_manifest(&pool, &uuid).await.unwrap();
    assert_eq!(manifest.files.len(), 1);
}

#[tokio::test]
async fn api_delete_book_files_422s_when_a_copy_belongs_to_another_book() {
    let (app, _state, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let (uuid, _, copy_id) = seed_book_with_file_and_copy(&pool).await;
    let (_, other_uuid) = seed_book_with_uuid(&pool, "/lib-b", "Other Book").await;
    let res = app
        .oneshot(post_json(
            &format!("/api/books/{other_uuid}/delete-files"),
            &token,
            serde_json::json!({ "copy_ids": [copy_id] }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let body = String::from_utf8(bytes.to_vec()).unwrap();
    assert_eq!(body, db::DeleteError::CopyNotFound(copy_id).to_string());
    // Nothing moved: the copy's own book still lists it.
    let copies = db::list_physical_copies(&pool, &uuid).await.unwrap();
    assert_eq!(copies.len(), 1);
    assert_eq!(copies[0].id, copy_id);
}

#[tokio::test]
async fn api_delete_book_files_500s_when_the_db_is_gone() {
    let (app, _state, pool) = fixture().await;
    let token = admin_token(&pool).await;
    let (uuid, file_id, _) = seed_book_with_file_and_copy(&pool).await;
    sqlx::query("DROP TABLE physical_copies")
        .execute(&pool)
        .await
        .unwrap();
    let res = app
        .oneshot(post_json(
            &format!("/api/books/{uuid}/delete-files"),
            &token,
            serde_json::json!({ "file_ids": [file_id] }),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
