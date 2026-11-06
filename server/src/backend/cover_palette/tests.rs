//! Tests for the `GET /api/books/{uuid}/cover/palette` REST handler.
use axum::{body::to_bytes, http::StatusCode};
use omnibus_db::test_support::striped_png;
use omnibus_shared::CoverPalette;
use tower::ServiceExt;

use super::*;
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

const PALETTE_PATH: &str = "cover/palette";

#[tokio::test]
async fn api_get_cover_palette_returns_pairs_for_a_book_with_a_cover() {
    let (app, _, pool) = fixture().await;
    let (id, uuid) = seed_book_with_uuid(&pool, "/lib", "Striped").await;
    sqlx::query("UPDATE books SET has_cover = 1 WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let _covers_guard = CoversDirGuard::new("cover_palette_200");
    let cover = striped_png(&[[200, 40, 40], [20, 20, 20], [40, 60, 160]], 64, 96);
    std::fs::write(db::covers_dir().join(format!("{uuid}.png")), cover).unwrap();
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/{PALETTE_PATH}"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let palette: CoverPalette = serde_json::from_slice(&body).unwrap();
    assert!(!palette.pairs.is_empty());
}

#[tokio::test]
async fn api_get_cover_palette_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;

    let res = app
        .oneshot(get_anon(&format!("/api/books/any-uuid/{PALETTE_PATH}")))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_cover_palette_returns_404_when_book_not_found() {
    let (app, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/missing-uuid/{PALETTE_PATH}"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_get_cover_palette_returns_404_when_book_has_no_cover() {
    let (app, _, pool) = fixture().await;
    let _ = seed_book_no_cover(&pool).await;
    let uuid = "00000000-0000-0000-0000-000000000001";
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/{uuid}/{PALETTE_PATH}"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_get_cover_palette_returns_500_when_books_table_is_missing() {
    let (app, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    sqlx::query("DROP TABLE books")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/books/any-uuid/{PALETTE_PATH}"),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
