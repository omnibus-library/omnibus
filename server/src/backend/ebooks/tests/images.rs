//! `GET /api/ebooks/{uuid}/images`, `.../images/file`, `.../images/link` and
//! `.../images/signed`: the EPUB image listing, the original-bytes fetch and the
//! signed link to it: auth gating, query-token auth, spine references, the
//! attachment-and-validator headers, the 400 for an href that is no manifest
//! image, the download-permission 403, and the unknown-uuid 404 and no-EPUB 422.

use axum::{body::to_bytes, http::StatusCode};
use omnibus_shared::{BookImage, BookImageLink, BookImageList, BookImageReference};
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

use super::super::images::sign_image_link;
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

/// An EPUB with `map.png` and `plate.png` (different pixels, so different
/// bytes), neither shown by any chapter, returning both PNGs.
fn epub_with_two_images() -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let map = db::test_support::solid_color_png(1, 2, 3, 4, 3);
    let plate = db::test_support::solid_color_png(9, 8, 7, 5, 5);
    let epub = db::test_support::build_test_epub_with_images(
        &[("c1.xhtml", "<html><body><p>Text.</p></body></html>")],
        &[
            ("map.png", "image/png", &map),
            ("plate.png", "image/png", &plate),
        ],
    );
    (epub, map, plate)
}

fn header(res: &axum::response::Response, name: axum::http::HeaderName) -> String {
    res.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

#[tokio::test]
async fn api_get_ebook_image_file_returns_the_original_bytes_as_an_attachment_with_validators() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (epub, map, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/ebooks/{uuid}/images/file?href=map.png"),
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(header(&res, axum::http::header::CONTENT_TYPE), "image/png");
    assert_eq!(
        header(&res, axum::http::header::CONTENT_DISPOSITION),
        "attachment; filename=\"map.png\"; filename*=UTF-8''map.png"
    );
    assert_eq!(
        header(&res, axum::http::header::CACHE_CONTROL),
        "private, no-cache"
    );
    assert_eq!(
        header(&res, axum::http::header::VARY),
        "Cookie, Authorization"
    );
    assert_eq!(
        header(&res, axum::http::header::X_CONTENT_TYPE_OPTIONS),
        "nosniff"
    );
    let etag = header(&res, axum::http::header::ETAG);
    assert!(
        etag.starts_with('"') && etag.ends_with('"'),
        "strong entity-tag, got: {etag}"
    );
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], &map[..]);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_image_file_gives_each_href_its_own_etag() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;
    let app = crate::backend::rest_router(AppState::new(pool));

    let mut etags = Vec::new();
    for href in ["map.png", "plate.png"] {
        let res = app
            .clone()
            .oneshot(get_with_bearer(
                &format!("/api/ebooks/{uuid}/images/file?href={href}"),
                &token,
            ))
            .await
            .expect("request should succeed");
        etags.push(header(&res, axum::http::header::ETAG));
    }

    assert_ne!(etags[0], etags[1]);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_image_file_answers_if_none_match_with_304_and_same_headers() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;
    let app = crate::backend::rest_router(AppState::new(pool));
    let uri = format!("/api/ebooks/{uuid}/images/file?href=map.png");

    let first = app
        .clone()
        .oneshot(get_with_bearer(&uri, &token))
        .await
        .expect("request should succeed");
    let etag = header(&first, axum::http::header::ETAG);
    let second = app
        .oneshot(get_with_bearer_and_if_none_match(&uri, &token, &etag))
        .await
        .expect("request should succeed");

    assert_eq!(second.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(header(&second, axum::http::header::ETAG), etag);
    assert_eq!(
        header(&second, axum::http::header::VARY),
        "Cookie, Authorization",
        "304 carries MEDIA_VARY so a shared cache can't cross users"
    );
    assert_eq!(
        header(&second, axum::http::header::CACHE_CONTROL),
        "private, no-cache"
    );

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_image_file_returns_400_for_an_href_that_is_not_a_manifest_image() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/ebooks/{uuid}/images/file?href=c1.xhtml"),
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        body_text(res).await,
        "href is not an image in this book's EPUB manifest"
    );

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_image_file_falls_back_to_octet_stream_when_the_media_type_is_not_header_safe(
) {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let png = db::test_support::solid_color_png(1, 2, 3, 2, 2);
    // `&#10;` is a newline once parsed: a media type that cannot be a header value.
    let epub = db::test_support::build_test_epub_with_images(
        &[("c1.xhtml", "<html><body><p>Text.</p></body></html>")],
        &[("odd.png", "image/png&#10;X-Injected: 1", &png)],
    );
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/ebooks/{uuid}/images/file?href=odd.png"),
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        header(&res, axum::http::header::CONTENT_TYPE),
        "application/octet-stream"
    );
    assert!(res.headers().get("x-injected").is_none());

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_image_file_returns_404_for_an_unknown_uuid() {
    let (app, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(get_with_bearer(
            "/api/ebooks/00000000-0000-0000-0000-00000000dead/images/file?href=map.png",
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_get_ebook_image_file_returns_422_for_a_book_without_an_epub() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (uuid, tmp) = seed_cbz_on_disk(&pool).await;

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/ebooks/{uuid}/images/file?href=map.png"),
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body_text(res).await, "book has no EPUB file");

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_image_file_returns_403_without_download_permission() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    revoke_can_download(&pool, user.id).await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/ebooks/{uuid}/images/file?href=map.png"),
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_image_file_returns_200_with_query_token() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_anon(&format!(
            "/api/ebooks/{uuid}/images/file?href=map.png&token={token}"
        )))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::OK);

    std::fs::remove_dir_all(&tmp).ok();
}

fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

/// Mint a link for `href` as `token`'s user through the real endpoint.
async fn mint(app: &axum::Router, token: &str, uuid: &str, href: &str) -> BookImageLink {
    let res = app
        .clone()
        .oneshot(get_with_bearer(
            &format!(
                "/api/ebooks/{uuid}/images/link?href={}",
                urlencoding::encode(href)
            ),
            token,
        ))
        .await
        .expect("request should succeed");
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn api_get_ebook_image_link_returns_a_signed_path_expiring_after_the_ttl() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;
    let app = crate::backend::rest_router(AppState::new(pool));

    let before = now();
    let res = app
        .clone()
        .oneshot(get_with_bearer(
            &format!("/api/ebooks/{uuid}/images/link?href=OEBPS%2Fimages%2Fmap.png"),
            &token,
        ))
        .await
        .expect("request should succeed");
    let after = now();

    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(header(&res, axum::http::header::CACHE_CONTROL), "no-store");
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let link: BookImageLink = serde_json::from_slice(&bytes).unwrap();
    assert!(
        (before + 15 * 60..=after + 15 * 60).contains(&link.expires_at),
        "expires_at {} is not 15 minutes out",
        link.expires_at
    );
    let expected_prefix = format!(
        "/api/ebooks/{uuid}/images/signed?href=OEBPS%2Fimages%2Fmap.png&expires={}&sig=",
        link.expires_at
    );
    assert!(
        link.path.starts_with(&expected_prefix),
        "unexpected path {}",
        link.path
    );

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_image_link_returns_403_without_download_permission() {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    revoke_can_download(&pool, user.id).await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/ebooks/{uuid}/images/link?href=map.png"),
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_image_link_returns_404_for_an_unknown_uuid() {
    let (app, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(get_with_bearer(
            "/api/ebooks/00000000-0000-0000-0000-00000000dead/images/link?href=map.png",
            &token,
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn api_get_ebook_image_link_returns_401_when_anonymous() {
    let (app, _, _) = fixture().await;
    let res = app
        .oneshot(get_anon("/api/ebooks/some-uuid/images/link?href=map.png"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_ebook_signed_image_serves_the_original_without_a_session() {
    let (_, _, pool) = fixture().await;
    let admin = auth_test_support::create_admin(&pool, "admin").await;
    let token = auth_test_support::bearer_token(&pool, admin.id).await;
    let (epub, map, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;
    let app = crate::backend::rest_router(AppState::new(pool));
    let link = mint(&app, &token, &uuid, "map.png").await;

    let res = app
        .oneshot(get_anon(&link.path))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::OK);
    assert!(
        header(&res, axum::http::header::CONTENT_DISPOSITION).starts_with("attachment"),
        "a signed fetch is still a download"
    );
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], &map[..]);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_signed_image_returns_401_for_an_expired_link() {
    let (_, _, pool) = fixture().await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;
    let key = db::auth::load_or_create_session_key(&pool).await.unwrap();
    let expires = now() - 1;
    let sig = sign_image_link(&key, &uuid, "map.png", expires).unwrap();
    let app = crate::backend::rest_router(AppState::new(pool));

    let res = app
        .oneshot(get_anon(&format!(
            "/api/ebooks/{uuid}/images/signed?href=map.png&expires={expires}&sig={sig}"
        )))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_signed_image_returns_401_for_a_link_used_on_another_href() {
    let (_, _, pool) = fixture().await;
    let admin = auth_test_support::create_admin(&pool, "admin").await;
    let token = auth_test_support::bearer_token(&pool, admin.id).await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;
    let app = crate::backend::rest_router(AppState::new(pool));
    let link = mint(&app, &token, &uuid, "map.png").await;

    let res = app
        .oneshot(get_anon(
            &link.path.replace("href=map.png", "href=plate.png"),
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_signed_image_returns_401_for_a_link_without_a_usable_expiry() {
    let (_, _, pool) = fixture().await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;
    let key = db::auth::load_or_create_session_key(&pool).await.unwrap();
    // Signed over the value a missing or garbled expiry could default to, so only the guard rejects it.
    let sig = sign_image_link(&key, &uuid, "map.png", i64::MAX).unwrap();
    let app = crate::backend::rest_router(AppState::new(pool));
    let file = format!("/api/ebooks/{uuid}/images/signed?href=map.png");

    let control = app
        .clone()
        .oneshot(get_anon(&format!("{file}&expires={}&sig={sig}", i64::MAX)))
        .await
        .expect("request should succeed");
    assert_eq!(control.status(), StatusCode::OK, "the signature is real");
    for expiry in ["", "&expires=soon"] {
        let res = app
            .clone()
            .oneshot(get_anon(&format!("{file}{expiry}&sig={sig}")))
            .await
            .expect("request should succeed");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{expiry:?}");
    }

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_signed_image_returns_401_before_any_key_exists_and_creates_none() {
    let (_, _, pool) = fixture().await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;
    let app = crate::backend::rest_router(AppState::new(pool.clone()));
    let expires = now() + 60;

    let res = app
        .oneshot(get_anon(&format!(
            "/api/ebooks/{uuid}/images/signed?href=map.png&expires={expires}&sig=AAAA"
        )))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(db::auth::get_session_key(&pool).await.unwrap(), None);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_signed_image_returns_401_without_a_signature() {
    let (_, _, pool) = fixture().await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;
    db::auth::load_or_create_session_key(&pool).await.unwrap();
    let app = crate::backend::rest_router(AppState::new(pool));
    let expires = now() + 60;

    let res = app
        .oneshot(get_anon(&format!(
            "/api/ebooks/{uuid}/images/signed?href=map.png&expires={expires}"
        )))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn api_get_ebook_image_file_returns_401_for_a_valid_signature_without_a_session() {
    let (_, _, pool) = fixture().await;
    let admin = auth_test_support::create_admin(&pool, "admin").await;
    let token = auth_test_support::bearer_token(&pool, admin.id).await;
    let (epub, _, _) = epub_with_two_images();
    let (uuid, _, _, tmp) = seed_epub_with_bytes(&pool, &epub).await;
    let app = crate::backend::rest_router(AppState::new(pool));
    let link = mint(&app, &token, &uuid, "map.png").await;

    let res = app
        .oneshot(get_anon(
            &link.path.replace("/images/signed", "/images/file"),
        ))
        .await
        .expect("request should succeed");

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    std::fs::remove_dir_all(&tmp).ok();
}

/// GET `path` as a signed-in reader after dropping `books`, so the uuid lookup every
/// image route starts with fails. FKs off on the one connection, as `books` is referenced.
async fn status_when_the_book_lookup_fails(path: &str) -> StatusCode {
    let (_, _, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "alice").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query("DROP TABLE books")
        .execute(&mut *conn)
        .await
        .unwrap();
    drop(conn);

    let app = crate::backend::rest_router(AppState::new(pool));
    let res = app
        .oneshot(get_with_bearer(path, &token))
        .await
        .expect("request should succeed");
    res.status()
}

#[tokio::test]
async fn api_get_ebook_images_returns_500_when_the_book_lookup_fails() {
    let status = status_when_the_book_lookup_fails("/api/ebooks/any-uuid/images").await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn api_get_ebook_image_link_returns_500_when_the_book_lookup_fails() {
    let status =
        status_when_the_book_lookup_fails("/api/ebooks/any-uuid/images/link?href=map.png").await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn api_get_ebook_image_file_returns_500_when_the_book_lookup_fails() {
    let status =
        status_when_the_book_lookup_fails("/api/ebooks/any-uuid/images/file?href=map.png").await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}
