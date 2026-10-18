//! `GET /api/ebooks/{uuid}/images`: the EPUB image listing's auth gating,
//! query-token auth, spine references, and its unknown-uuid 404 and
//! no-EPUB 422.

use axum::{body::to_bytes, http::StatusCode};
use omnibus_shared::{BookImage, BookImageList, BookImageReference};
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

use super::super::*;
use super::seed_cbz_on_disk;

/// An EPUB whose first chapter shows `map.png` and whose second shows nothing,
/// so the listing has one referenced image and the PNG's own bytes to size.
fn epub_with_one_map() -> (Vec<u8>, Vec<u8>) {
    let png = db::test_support::solid_color_png(1, 2, 3, 4, 3);
    let epub = db::test_support::build_test_epub_with_images(
        &[
            (
                "c1.xhtml",
                r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="map.png" alt="A map"/></body></html>"#,
            ),
            ("c2.xhtml", "<html><body><p>No pictures.</p></body></html>"),
        ],
        &[("map.png", "image/png", &png)],
    );
    (epub, png)
}

#[tokio::test]
async fn api_get_ebook_images_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;
    let res = app
        .oneshot(get_anon("/api/ebooks/some-uuid/images"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_ebook_images_returns_each_image_with_its_spine_references() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (epub, png) = epub_with_one_map();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/ebooks/{uuid}/images"),
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let list: BookImageList = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        list,
        BookImageList {
            book_uuid: uuid,
            images: vec![BookImage {
                href: "map.png".into(),
                media_type: "image/png".into(),
                byte_size: png.len() as i64,
                width: Some(4),
                height: Some(3),
                references: vec![BookImageReference {
                    spine_index: 0,
                    alt: Some("A map".into()),
                }],
            }],
        }
    );

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_images_returns_200_with_query_token() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (epub, _) = epub_with_one_map();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_anon(&format!(
            "/api/ebooks/{uuid}/images?token={token}"
        )))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::OK);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_images_returns_404_for_an_unknown_uuid() {
    let (app, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(get_with_bearer(
            "/api/ebooks/00000000-0000-0000-0000-00000000dead/images",
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_get_ebook_images_returns_422_for_a_book_without_an_epub() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (uuid, tmp) = seed_cbz_on_disk(&pool).await;

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/ebooks/{uuid}/images"),
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body_text(res).await, "book has no EPUB file");

    std::fs::remove_dir_all(&tmp).ok();
}
