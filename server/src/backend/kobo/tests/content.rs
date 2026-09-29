//! The byte- and metadata-serving routes: `/v1/library/{uuid}/metadata`,
//! the download (kepub, plain-EPUB fallback, CBZ passthrough), and the cover
//! image with its conditional-request handling.

use axum::{
    body::{to_bytes, Body},
    http::{header::AUTHORIZATION, Request, StatusCode},
    Router,
};
use omnibus_db::{self as db, test_support::seed_synced_ebook};
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::{
    body_json, book_metadata, fixture, get, kobo_router, seed_book_with_kepub_cache,
    seed_downloadable_book, seed_override_cover,
};
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::{
    build_cover_multipart, fixture_loopback_remote_image, seed_book_with_uuid, CoversDirGuard,
    TINY_PNG,
};

#[tokio::test]
async fn image_returns_304_when_the_if_none_match_etag_is_current() {
    // The 304 path fires before the cover bytes are ever loaded, so a current
    // validator answers bodyless even while the book has no stored cover.
    let (app, pool, token, _uid) = fixture().await;
    let uuid = seed_synced_ebook(&pool, "dune.epub", "Dune", "Herbert").await;
    let (id, lm): (i64, i64) = sqlx::query_as(
        "SELECT id, CAST(COALESCE(last_modified, 0) AS INTEGER) FROM books WHERE uuid = ?",
    )
    .bind(&uuid)
    .fetch_one(&pool)
    .await
    .unwrap();
    let etag = format!("W/\"{id}-{lm}\"");

    let res = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/kobo/{token}/v1/books/{uuid}/thumbnail/400/600/100/false/image.jpg"
                ))
                .header("host", "omni.test")
                .header("if-none-match", &etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(res.headers().get("etag").unwrap().to_str().unwrap(), etag);
}

#[tokio::test]
async fn image_serves_the_body_when_the_etag_is_stale() {
    // A stale validator falls through to the normal serve path — here a 404,
    // since the fixture book has no stored cover. The point is that it did NOT
    // answer 304 against a stale tag.
    let (app, pool, token, _uid) = fixture().await;
    let uuid = seed_synced_ebook(&pool, "dune.epub", "Dune", "Herbert").await;

    let res = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/kobo/{token}/v1/books/{uuid}/thumbnail/400/600/100/false/image.jpg"
                ))
                .header("host", "omni.test")
                .header("if-none-match", "W/\"stale\"")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn metadata_returns_the_book() {
    let (app, pool, token, _uid) = fixture().await;
    let uuid = seed_synced_ebook(&pool, "gatsby.epub", "The Great Gatsby", "Fitzgerald").await;
    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/library/{uuid}/metadata")))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let json = body_json(res).await;
    assert_eq!(json[0]["Title"], "The Great Gatsby");
}

#[tokio::test]
async fn metadata_returns_404_for_unknown_uuid() {
    let (app, _pool, token, _uid) = fixture().await;
    let res = app
        .oneshot(get(format!(
            "/kobo/{token}/v1/library/does-not-exist/metadata"
        )))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn download_returns_404_for_unknown_uuid() {
    let (app, _pool, token, _uid) = fixture().await;
    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/download/does-not-exist")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

/// #1647: the book row (and its `book_files` entry) resolves fine — only the
/// actual bytes are missing, so `serve_download` 404s from `conditional::open`
/// failing rather than from the earlier uuid/id lookups. That later 404 must
/// close the same gap the id-lookup 404 above closes: a device that never
/// got a file must not be recorded as holding it, or the next
/// `checkforchanges` cycle silently acks annotations away from a device that
/// has nothing to show them in.
#[tokio::test]
async fn download_does_not_record_download_state_when_the_file_open_fails() {
    // Force kepubify absent so this deterministically takes the plain-EPUB
    // fallback and reaches `serve_download` with a `book_file_path` pointing
    // at bytes that were never written to disk.
    let _kepubify_absent =
        db::test_support::EnvVarGuard::set("OMNIBUS_KEPUBIFY_PATH", Some("/no/such/kepubify"));
    let (app, pool, token, _uid) = fixture().await;
    let device_id = db::kobo_devices::resolve_device_by_token(&pool, &token)
        .await
        .unwrap()
        .unwrap()
        .device_id;
    let uuid = seed_synced_ebook(&pool, "phantom.epub", "Phantom", "Nobody").await;

    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/download/{uuid}")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let recorded: Option<i64> = sqlx::query_scalar(
        "SELECT downloaded_at FROM kobo_annotations_sync WHERE device_id = ? AND book_uuid = ?",
    )
    .bind(device_id)
    .bind(&uuid)
    .fetch_optional(&pool)
    .await
    .unwrap()
    .flatten();
    assert!(
        recorded.is_none(),
        "a 404'd download must not mark the device as holding the book"
    );
}

/// #1391: kepubify is absent in the test environment, so `download` takes its
/// plain-EPUB fallback arm — which must still route through
/// `rewritten_or_source` (mirrors `api_get_ebook_download_bakes_metadata_override_into_epub`
/// in `ebooks/tests.rs`) rather than serving the raw on-disk file.
#[tokio::test]
async fn download_bakes_a_metadata_override_into_the_plain_epub_fallback() {
    use std::io::Cursor;

    let (app, pool, token, uid) = fixture().await;

    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("omnibus_kobo_dl_override_{pid}_{nanos}"));
    let export = tmp.join("export");
    std::fs::create_dir_all(&export).unwrap();
    // Isolate the export cache so the rewrite doesn't land in ./data.
    let _env =
        db::test_support::EnvVarGuard::set_os("OMNIBUS_EXPORT_EPUB_DIR", Some(export.as_os_str()));

    // Copy a real fixture EPUB so the rewrite has a valid container to parse.
    let fixture_epub = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test_data/epubs/generated/alpha.epub");
    let stem = "alpha";
    std::fs::copy(&fixture_epub, tmp.join(format!("{stem}.epub"))).unwrap();

    let lib_id = sqlx::query("INSERT INTO scan_roots (path, display_name) VALUES (?, 'lib')")
        .bind(tmp.to_str().unwrap())
        .execute(&pool)
        .await
        .unwrap()
        .last_insert_rowid();
    let uuid = "55555555-5555-5555-5555-555555555555";
    sqlx::query(
        "INSERT INTO books (uuid, library_id, path, title, last_modified) \
         VALUES (?, ?, ?, 'Alpha', 1)",
    )
    .bind(uuid)
    .bind(lib_id)
    .bind(tmp.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO book_files (book_id, format, filename, size_bytes) \
         VALUES ((SELECT id FROM books WHERE uuid = ?), 'EPUB', ?, 0)",
    )
    .bind(uuid)
    .bind(stem)
    .execute(&pool)
    .await
    .unwrap();

    let overrides = omnibus_shared::MetadataOverrides {
        title: Some("Stormlight #1".into()),
        ..Default::default()
    };
    db::upsert_metadata_overrides(&pool, uuid, &overrides, false, uid)
        .await
        .unwrap();

    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/download/{uuid}")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();

    let doc = epub::doc::EpubDoc::from_reader(Cursor::new(bytes.to_vec()))
        .expect("downloaded bytes are a valid EPUB");
    assert_eq!(
        doc.mdata("title").map(|m| m.value.clone()),
        Some("Stormlight #1".to_string()),
        "kobo download fallback must carry the baked title override"
    );

    std::fs::remove_dir_all(&tmp).ok();
}

/// A PDF-only book downloads as the raw PDF — no conversion attempt, the
/// PDF mime, and the #1647 bookkeeping — the same shape as the CBZ arm.
#[tokio::test]
async fn download_serves_the_pdf_as_is_for_a_pdf_only_book() {
    let (app, pool, token, _uid) = fixture().await;
    let device_id = db::kobo_devices::resolve_device_by_token(&pool, &token)
        .await
        .unwrap()
        .unwrap()
        .device_id;

    let tmp = db::test_support::make_test_dir("kobo_dl_pdf");
    let pdf = db::test_support::build_test_pdf(&db::test_support::TestPdf {
        pages: &["Flatland"],
        ..Default::default()
    });
    std::fs::write(tmp.join("flatland.pdf"), &pdf).unwrap();

    let lib_id = sqlx::query("INSERT INTO scan_roots (path, display_name) VALUES (?, 'lib')")
        .bind(tmp.to_str().unwrap())
        .execute(&pool)
        .await
        .unwrap()
        .last_insert_rowid();
    let uuid = "67676767-6767-6767-6767-676767676767";
    sqlx::query(
        "INSERT INTO books (uuid, library_id, path, title, last_modified) \
         VALUES (?, ?, ?, 'Flatland', 1)",
    )
    .bind(uuid)
    .bind(lib_id)
    .bind(tmp.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO book_files (book_id, format, filename, size_bytes) \
         VALUES ((SELECT id FROM books WHERE uuid = ?), 'PDF', 'flatland', 0)",
    )
    .bind(uuid)
    .execute(&pool)
    .await
    .unwrap();

    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/download/{uuid}")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/pdf"),
    );
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], &pdf[..], "the PDF streams as-is");

    let recorded: Option<i64> = sqlx::query_scalar(
        "SELECT downloaded_at FROM kobo_annotations_sync WHERE device_id = ? AND book_uuid = ?",
    )
    .bind(device_id)
    .bind(uuid)
    .fetch_optional(&pool)
    .await
    .unwrap()
    .flatten();
    assert!(recorded.is_some(), "a served PDF records the download");

    std::fs::remove_dir_all(&tmp).ok();
}

/// #1741: a CBZ-only book downloads as the raw archive (no conversion
/// attempt, so no kepubify guard) and still runs the #1647 bookkeeping.
#[tokio::test]
async fn download_serves_the_cbz_archive_as_is_for_a_cbz_only_book() {
    let (app, pool, token, _uid) = fixture().await;
    let device_id = db::kobo_devices::resolve_device_by_token(&pool, &token)
        .await
        .unwrap()
        .unwrap()
        .device_id;

    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("omnibus_kobo_dl_cbz_{pid}_{nanos}"));
    std::fs::create_dir_all(&tmp).unwrap();
    let archive = db::test_support::build_stored_zip(&[("p1.jpg", b"page-one")]);
    std::fs::write(tmp.join("aurora.cbz"), &archive).unwrap();

    let lib_id = sqlx::query("INSERT INTO scan_roots (path, display_name) VALUES (?, 'lib')")
        .bind(tmp.to_str().unwrap())
        .execute(&pool)
        .await
        .unwrap()
        .last_insert_rowid();
    let uuid = "66666666-6666-6666-6666-666666666666";
    sqlx::query(
        "INSERT INTO books (uuid, library_id, path, title, last_modified) \
         VALUES (?, ?, ?, 'Aurora', 1)",
    )
    .bind(uuid)
    .bind(lib_id)
    .bind(tmp.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO book_files (book_id, format, filename, size_bytes) \
         VALUES ((SELECT id FROM books WHERE uuid = ?), 'CBZ', 'aurora', 0)",
    )
    .bind(uuid)
    .execute(&pool)
    .await
    .unwrap();

    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/download/{uuid}")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/vnd.comicbook+zip"),
    );
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], &archive[..], "the archive streams as-is");

    let recorded: Option<i64> = sqlx::query_scalar(
        "SELECT downloaded_at FROM kobo_annotations_sync WHERE device_id = ? AND book_uuid = ?",
    )
    .bind(device_id)
    .bind(uuid)
    .fetch_optional(&pool)
    .await
    .unwrap()
    .flatten();
    assert!(
        recorded.is_some(),
        "a served CBZ must record the device as holding the book (#1647 gate)"
    );

    std::fs::remove_dir_all(&tmp).ok();
}

/// #1647 (AC2): a web-origin highlight created before the device ever
/// downloaded the book sits un-downsynced (`kobo_location` still `NULL` —
/// nothing had a kepub cache to derive against). Downloading the book must
/// materialize it and make the pair checkforchanges-reportable in the same
/// request, with no remove-and-re-download dance.
#[tokio::test]
async fn download_records_holding_the_book_and_materializes_a_pending_web_highlight() {
    let (app, pool, token, uid) = fixture().await;
    let (uuid, _guard, _lib) = seed_book_with_kepub_cache(&pool, "ac2", true).await;
    let device_id = db::kobo_devices::resolve_device_by_token(&pool, &token)
        .await
        .unwrap()
        .unwrap()
        .device_id;

    db::annotations::create_highlight(
        &pool,
        uid,
        &omnibus_shared::CreateHighlight {
            book_uuid: uuid.clone(),
            epub_cfi_range: "epubcfi(/6/2!/4/4,/1:0,/1:29)".into(),
            color: omnibus_shared::HighlightColor::Green,
            text: Some("Second paragraph target text.".into()),
            client_id: Some("web-ac2".into()),
        },
    )
    .await
    .unwrap();

    // Nothing to serve yet — the highlight has no `kobo_location`, and this
    // device hasn't downloaded the book.
    assert!(db::annotations::served_kobo_annotations(&pool, uid, &uuid)
        .await
        .unwrap()
        .is_empty());
    assert!(
        db::kobo::annotations::changed_book_uuids(&pool, uid, device_id)
            .await
            .unwrap()
            .is_empty()
    );

    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/download/{uuid}")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let served = db::annotations::served_kobo_annotations(&pool, uid, &uuid)
        .await
        .unwrap();
    assert_eq!(served.len(), 1, "download materialized the pending row");
    assert_eq!(
        db::kobo::annotations::changed_book_uuids(&pool, uid, device_id)
            .await
            .unwrap(),
        vec![uuid],
        "the download-state row makes the pair reportable without a PATCH"
    );
}

#[tokio::test]
async fn image_returns_404_for_unknown_uuid() {
    let (app, _pool, token, _uid) = fixture().await;
    let res = app
        .oneshot(get(format!(
            "/kobo/{token}/v1/books/nope/thumbnail/400/600/100/false/image.jpg"
        )))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn metadata_returns_500_on_db_failure() {
    let (app, pool, token, _uid) = fixture().await;
    sqlx::query("DROP TABLE books")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/library/any-uuid/metadata")))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn download_returns_500_on_db_failure_when_resolving_book_id_fails() {
    let (app, pool, token, _uid) = fixture().await;
    sqlx::query("DROP TABLE books")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/download/any-uuid")))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn download_returns_500_on_db_failure_when_locating_the_epub_file_fails() {
    // Force kepubify absent so `download` deterministically takes the
    // plain-EPUB fallback and calls `book_file_path`, regardless of whether
    // kepubify happens to be installed in the environment running this test.
    let _kepubify_absent =
        db::test_support::EnvVarGuard::set("OMNIBUS_KEPUBIFY_PATH", Some("/no/such/kepubify"));
    // Keep `books` intact (the uuid must resolve) and drop `book_files`
    // instead, so this reaches that second `internal(...)` call site
    // rather than the earlier `resolve_book_id_by_uuid` one.
    let (app, pool, token, _uid) = fixture().await;
    let uuid = seed_synced_ebook(&pool, "solaris.epub", "Solaris", "Lem").await;
    sqlx::query("DROP TABLE book_files")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/download/{uuid}")))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn image_returns_500_on_db_failure() {
    let (app, pool, token, _uid) = fixture().await;
    sqlx::query("DROP TABLE books")
        .execute(&pool)
        .await
        .unwrap();

    let res = app
        .oneshot(get(format!(
            "/kobo/{token}/v1/books/any-uuid/thumbnail/400/600/100/false/image.jpg"
        )))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

/// The cover route's answer for `image_id`, in the quality-template shape.
async fn fetch_cover(kobo: &Router, token: &str, image_id: &str) -> (StatusCode, Vec<u8>) {
    let res = kobo
        .clone()
        .oneshot(get(format!(
            "/kobo/{token}/v1/books/{image_id}/thumbnail/400/600/100/false/image.jpg"
        )))
        .await
        .unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    (status, bytes.to_vec())
}

#[tokio::test]
async fn cover_writes_move_the_synced_cover_image_id_and_the_route_serves_the_new_bytes() {
    let _covers = CoversDirGuard::new("kobo_cover_image_id");
    let (rest, state, pool) = fixture_loopback_remote_image().await;
    let kobo = kobo_router(state);
    let (_id, uuid) = seed_book_with_uuid(&pool, "/lib", "Cover Id Book").await;
    let admin = auth_test_support::create_admin(&pool, "admin").await;
    let bearer = auth_test_support::bearer_token(&pool, admin.id).await;
    let device = db::kobo_devices::create_device(&pool, admin.id, "Test Kobo")
        .await
        .unwrap();
    let origin = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/cover.png"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "image/png")
                .set_body_bytes(TINY_PNG.to_vec()),
        )
        .mount(&origin)
        .await;

    let from_url = Request::builder()
        .uri(format!("/api/ebooks/{uuid}/cover/from-url"))
        .method("POST")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {bearer}"))
        .body(Body::from(
            serde_json::json!({ "url": format!("{}/cover.png", origin.uri()) }).to_string(),
        ))
        .unwrap();
    let (content_type, multipart) = build_cover_multipart("image/png", TINY_PNG);
    let upload = Request::builder()
        .uri(format!("/api/ebooks/{uuid}/cover"))
        .method("POST")
        .header("content-type", content_type)
        .header(AUTHORIZATION, format!("Bearer {bearer}"))
        .body(Body::from(multipart))
        .unwrap();
    let delete = Request::builder()
        .uri(format!("/api/ebooks/{uuid}/cover"))
        .method("DELETE")
        .header(AUTHORIZATION, format!("Bearer {bearer}"))
        .body(Body::empty())
        .unwrap();

    for (write, label) in [
        (from_url, "from-url"),
        (upload, "multipart upload"),
        (delete, "delete"),
    ] {
        // `last_modified` is second-granular, so pin it below any real write.
        sqlx::query("UPDATE books SET last_modified = 1 WHERE uuid = ?")
            .bind(&uuid)
            .execute(&pool)
            .await
            .unwrap();
        let before = book_metadata(&kobo, &device.token, &uuid).await["CoverImageId"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(before, format!("{uuid}-1"), "{label}");

        if label == "from-url" {
            let (status, _) = fetch_cover(&kobo, &device.token, &before).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "no cover before the write");
        }
        let res = rest.clone().oneshot(write).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "{label}");

        let after = book_metadata(&kobo, &device.token, &uuid).await["CoverImageId"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_ne!(after, before, "{label} must move the cover id");
        if label == "from-url" {
            let (status, body) = fetch_cover(&kobo, &device.token, &after).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(body, TINY_PNG, "the versioned id serves the new cover");
        }
    }
}

#[tokio::test]
async fn image_serves_requests_built_from_either_initialization_template() {
    let _covers = CoversDirGuard::new("kobo_image_templates");
    let (app, pool, token, uid) = fixture().await;
    let uuid = "62e1c9f0-0000-4000-8000-000000002684";
    seed_downloadable_book(&pool, uuid, "Template Book", "Ada Lovelace").await;
    seed_override_cover(&pool, uuid, uid).await;

    let res = app
        .clone()
        .oneshot(get(format!("/kobo/{token}/v1/initialization")))
        .await
        .unwrap();
    let init = body_json(res).await;

    for key in ["image_url_template", "image_url_quality_template"] {
        for image_id in [uuid.to_owned(), format!("{uuid}-1700000000")] {
            let url = init["Resources"][key]
                .as_str()
                .unwrap()
                .replace("{ImageId}", &image_id)
                .replace("{Width}", "400")
                .replace("{Height}", "600")
                .replace("{Quality}", "100")
                .replace("{IsGreyscale}", "false")
                .replace("http://omni.test", "");
            let res = app.clone().oneshot(get(url.clone())).await.unwrap();
            assert_eq!(res.status(), StatusCode::OK, "{url}");
            assert_eq!(
                res.headers()
                    .get(axum::http::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok()),
                Some("image/png"),
                "{url}"
            );
            let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
            assert_eq!(&bytes[..], TINY_PNG, "{url}");
        }
    }
}
