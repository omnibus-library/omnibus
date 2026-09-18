//! The review half of a commit: inspect carrying the full record and a cover
//! preview, the `overrides` diff layered over the legacy fields and pruned
//! back to what differs from the indexed row, a cover staged from bytes or a
//! provider URL, and the refusals that keep a bad review from ever placing a
//! file in the library.

use axum::{body::to_bytes, http::StatusCode};
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use omnibus_shared::{
    Contributor, EbookMetadata, MetadataOverrides, Settings, UploadCommitResult, UploadInspection,
};

use super::super::review::{legacy_overrides, prune_unchanged, LegacyFields};
use super::super::*;
use super::post_multipart;
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

/// One multipart part: a filename marks a file part, and a content type is
/// what the image validator reads.
struct Part<'a> {
    name: &'a str,
    filename: Option<&'a str>,
    content_type: Option<&'a str>,
    bytes: &'a [u8],
}

impl<'a> Part<'a> {
    fn text(name: &'a str, value: &'a str) -> Self {
        Part {
            name,
            filename: None,
            content_type: None,
            bytes: value.as_bytes(),
        }
    }

    fn file(name: &'a str, filename: &'a str, content_type: &'a str, bytes: &'a [u8]) -> Self {
        Part {
            name,
            filename: Some(filename),
            content_type: Some(content_type),
            bytes,
        }
    }
}

/// Build a `multipart/form-data` body whose file parts carry a content type —
/// the sibling of `super::multipart_body`, which cannot express one.
fn multipart_typed(parts: &[Part<'_>]) -> (String, Vec<u8>) {
    let boundary = "----omnibus-review-test-boundary";
    let mut body: Vec<u8> = Vec::new();
    for part in parts {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        match part.filename {
            Some(fname) => body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{}\"; filename=\"{fname}\"\r\n",
                    part.name
                )
                .as_bytes(),
            ),
            None => body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{}\"\r\n", part.name).as_bytes(),
            ),
        }
        if let Some(ct) = part.content_type {
            body.extend_from_slice(format!("Content-Type: {ct}\r\n").as_bytes());
        }
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(part.bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

/// `beta.epub`: two creators, a series, a publisher, a date and a cover —
/// every field the review form shows, from one committed fixture.
fn beta_epub() -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test_data/epubs/generated/beta.epub");
    std::fs::read(&path).unwrap_or_else(|e| panic!("read fixture {}: {e}", path.display()))
}

/// The committed two-chapter MP3 audiobook, one part.
fn compiled_tales_part() -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(
        "../test_data/audiobooks/generated/grace_hopper_series/the_compiled_tales/chapter01.mp3",
    );
    std::fs::read(&path).unwrap_or_else(|e| panic!("read fixture {}: {e}", path.display()))
}

/// Point the ebook library at a fresh temp dir and hand it back.
async fn ebook_library(pool: &sqlx::SqlitePool) -> tempfile::TempDir {
    let library = tempfile::tempdir().expect("temp library dir");
    db::set_settings(
        pool,
        &Settings {
            ebook_library_path: Some(library.path().to_string_lossy().to_string()),
            audiobook_library_path: None,
            scan_interval_hours: None,
        },
    )
    .await
    .expect("set library path");
    library
}

/// Point the audiobook library at a fresh temp dir and hand it back.
async fn audiobook_library(pool: &sqlx::SqlitePool) -> tempfile::TempDir {
    let library = tempfile::tempdir().expect("temp library dir");
    db::set_settings(
        pool,
        &Settings {
            ebook_library_path: None,
            audiobook_library_path: Some(library.path().to_string_lossy().to_string()),
            scan_interval_hours: None,
        },
    )
    .await
    .expect("set audiobook library path");
    library
}

async fn admin_token(pool: &sqlx::SqlitePool) -> String {
    let admin = auth_test_support::create_admin(pool, "admin").await;
    auth_test_support::bearer_token(pool, admin.id).await
}

/// Every regular file under `dir`, recursively — a refused commit must leave
/// none.
fn files_under(dir: &std::path::Path) -> usize {
    let mut count = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                count += 1;
            }
        }
    }
    count
}

async fn committed_book(pool: &sqlx::SqlitePool, res: axum::response::Response) -> EbookMetadata {
    assert_eq!(res.status(), StatusCode::CREATED);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let commit: UploadCommitResult = serde_json::from_slice(&bytes).unwrap();
    db::get_book_by_uuid(pool, &commit.uuid)
        .await
        .unwrap()
        .expect("uploaded book should be indexed")
}

// ── Inspect carries the whole record ─────────────────────────────

#[tokio::test]
async fn inspect_returns_the_full_record_and_a_cover_preview() {
    let (app, _state, pool) = fixture().await;
    let token = admin_token(&pool).await;

    let (ct, body) = multipart_typed(&[Part::file(
        "file",
        "beta.epub",
        "application/epub+zip",
        &beta_epub(),
    )]);
    let res = app
        .oneshot(post_multipart(
            "/api/uploads/ebooks/inspect",
            &token,
            &ct,
            body,
        ))
        .await
        .expect("request should succeed");
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let insp: UploadInspection = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(insp.publisher.as_deref(), Some("Omnibus Test Press"));
    assert_eq!(insp.published.as_deref(), Some("1969-07-20"));
    assert_eq!(insp.series.as_deref(), Some("Pioneers"));
    assert_eq!(insp.series_index.as_deref(), Some("1"));
    assert_eq!(insp.language.as_deref(), Some("en"));
    assert!(insp.has_cover);
    let preview = insp
        .cover_preview
        .expect("a covered file carries a preview");
    assert!(
        preview.starts_with("data:image/webp;base64,"),
        "{}",
        &preview[..40]
    );
}

// ── The diff lands, and only the diff ────────────────────────────

#[tokio::test]
async fn commit_layers_the_overrides_diff_and_stores_only_what_differs() {
    let (app, _state, pool) = fixture().await;
    let _covers = CoversDirGuard::new("review_commit_diff");
    let _library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    // Title and publisher restate the file; description and genres are new.
    let overrides = serde_json::json!({
        "title": "Beta in the Series",
        "publisher": "Omnibus Test Press",
        "description": "Reviewed on upload.",
        "genres": ["Space Opera"]
    })
    .to_string();
    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::text("overrides", &overrides),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let book = committed_book(&pool, res).await;

    assert_eq!(book.description.as_deref(), Some("Reviewed on upload."));
    assert_eq!(book.genres, vec!["Space Opera".to_string()]);
    let uuid = book.unique_identifier.clone().unwrap();
    let (stored, has_cover) = db::get_metadata_overrides(&pool, &uuid)
        .await
        .unwrap()
        .expect("an override row for the edited fields");
    assert!(
        stored.title.is_none(),
        "an unedited title leaves no override"
    );
    assert!(stored.publisher.is_none());
    assert_eq!(stored.description.as_deref(), Some("Reviewed on upload."));
    assert!(!has_cover, "no cover was staged");
}

#[tokio::test]
async fn commit_lets_the_overrides_diff_win_over_the_legacy_author_field() {
    let (app, _state, pool) = fixture().await;
    let _covers = CoversDirGuard::new("review_commit_authors");
    let _library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    // The form's author chips replaced the whole list; the legacy field
    // still carries the first name for the folder.
    let overrides = serde_json::json!({
        "creators": [{ "name": "G. Hopper", "role": "aut", "file_as": null }]
    })
    .to_string();
    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "G. Hopper"),
        Part::text("overrides", &overrides),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let book = committed_book(&pool, res).await;
    let names: Vec<&str> = book.creators.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["G. Hopper"], "the diff replaced the list wholesale");
}

#[tokio::test]
async fn commit_without_review_fields_still_files_the_book_for_an_older_client() {
    let (app, _state, pool) = fixture().await;
    let _covers = CoversDirGuard::new("review_commit_legacy");
    let library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let book = committed_book(&pool, res).await;
    assert!(!book.has_override, "nothing edited, nothing overridden");
    let placed = library
        .path()
        .join("grace-hopper")
        .join("beta-in-the-series")
        .join("beta-in-the-series.epub");
    assert!(placed.is_file(), "expected {}", placed.display());
}

// ── A staged cover goes with the book ────────────────────────────

#[tokio::test]
async fn commit_writes_a_staged_cover_as_the_override_cover() {
    let (app, _state, pool) = fixture().await;
    let _covers = CoversDirGuard::new("review_commit_cover");
    let _library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::file("cover", "cover.png", "image/png", TINY_PNG),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let book = committed_book(&pool, res).await;
    assert!(book.has_cover_override, "the picked image is the cover");
    let uuid = book.unique_identifier.unwrap();
    let (_, has_cover) = db::get_metadata_overrides(&pool, &uuid)
        .await
        .unwrap()
        .expect("the cover override row");
    assert!(has_cover);
}

#[tokio::test]
async fn commit_fetches_a_staged_provider_cover_under_the_cover_from_url_terms() {
    let _covers = CoversDirGuard::new("review_commit_cover_url");
    let (app, _state, pool) = fixture_loopback_remote_image().await;
    let _library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/cover.png"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "image/png")
                .set_body_bytes(TINY_PNG.to_vec()),
        )
        .mount(&server)
        .await;

    let url = format!("{}/cover.png", server.uri());
    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::text("cover_url", &url),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let book = committed_book(&pool, res).await;
    assert!(book.has_cover_override, "the provider's image is the cover");
}

// ── A refused review never places a file ─────────────────────────

#[tokio::test]
async fn commit_refuses_a_failing_provider_cover_without_placing_the_file() {
    let _covers = CoversDirGuard::new("review_commit_cover_url_fail");
    let (app, _state, pool) = fixture_loopback_remote_image().await;
    let library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/cover.png"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;

    let url = format!("{}/cover.png", server.uri());
    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::text("cover_url", &url),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    // A status we *received* is a refusal we make (400), not a transport
    // failure — the same line the cover-from-URL route draws.
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(files_under(library.path()), 0, "nothing was filed");
    assert!(db::list_books(&pool, &library.path().to_string_lossy())
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn commit_rejects_a_provider_cover_off_the_allowlist_without_placing_the_file() {
    let (app, _state, pool) = fixture().await;
    let library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::text("cover_url", "https://example.invalid/cover.png"),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(files_under(library.path()), 0);
}

#[tokio::test]
async fn commit_rejects_malformed_overrides_with_400_without_placing_the_file() {
    let (app, _state, pool) = fixture().await;
    let library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::text("overrides", "{not json"),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert!(String::from_utf8_lossy(&bytes).contains("overrides"));
    assert_eq!(files_under(library.path()), 0);
}

#[tokio::test]
async fn commit_rejects_an_overrides_diff_that_fails_validation_before_filing() {
    let (app, _state, pool) = fixture().await;
    let library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let overrides = serde_json::json!({
        "title": "x".repeat(MetadataOverrides::TITLE_MAX_LEN + 1)
    })
    .to_string();
    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::text("overrides", &overrides),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(files_under(library.path()), 0);
}

#[tokio::test]
async fn commit_rejects_a_non_image_cover_with_400_without_placing_the_file() {
    let (app, _state, pool) = fixture().await;
    let library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::file("cover", "cover.txt", "text/plain", b"not a picture"),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(files_under(library.path()), 0);
}

// ── Audiobooks take the same review ──────────────────────────────

#[tokio::test]
async fn audiobook_commit_layers_the_overrides_diff_and_a_staged_cover() {
    let (app, _state, pool) = fixture().await;
    let _covers = CoversDirGuard::new("review_audiobook_commit");
    let _library = audiobook_library(&pool).await;
    let token = admin_token(&pool).await;

    let overrides = serde_json::json!({
        "description": "Reviewed on upload.",
        "series": "Grace Hopper Series",
        "series_index": "2"
    })
    .to_string();
    let part = compiled_tales_part();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "The Compiled Tales"),
        Part::text("author", "Grace Hopper"),
        Part::text("overrides", &overrides),
        Part::file("cover", "cover.png", "image/png", TINY_PNG),
        Part::file("file", "chapter01.mp3", "audio/mpeg", &part),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/audiobooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let book = committed_book(&pool, res).await;
    assert_eq!(book.description.as_deref(), Some("Reviewed on upload."));
    assert_eq!(book.series.as_deref(), Some("Grace Hopper Series"));
    assert_eq!(book.series_index.as_deref(), Some("2"));
    assert!(book.has_cover_override);
}

// ── The pure halves ──────────────────────────────────────────────

fn indexed() -> EbookMetadata {
    EbookMetadata {
        title: Some("Dune".into()),
        publisher: Some("Chilton".into()),
        series: Some("Dune".into()),
        creators: vec![Contributor {
            name: "Frank Herbert".into(),
            role: Some("aut".into()),
            file_as: Some("Herbert, Frank".into()),
            id: Some(3),
        }],
        subjects: vec!["scifi".into()],
        print_pages: Some(412),
        ..Default::default()
    }
}

#[test]
fn prune_unchanged_drops_every_field_that_restates_the_indexed_row() {
    let book = indexed();
    let mut ov = MetadataOverrides {
        title: Some("Dune".into()),
        publisher: Some("Chilton".into()),
        // An empty override against a book with no description is a no-op.
        description: Some(String::new()),
        series: Some("Dune".into()),
        creators: Some(vec![Contributor {
            name: "Frank Herbert".into(),
            role: Some("aut".into()),
            file_as: None,
            id: None,
        }]),
        subjects: Some(vec!["scifi".into()]),
        genres: Some(vec![]),
        print_pages: Some(412),
        // The one real edit.
        language: Some("en".into()),
        ..Default::default()
    };
    prune_unchanged(&mut ov, &book);
    assert_eq!(
        ov,
        MetadataOverrides {
            language: Some("en".into()),
            ..Default::default()
        }
    );
}

#[test]
fn prune_unchanged_keeps_a_clearing_override_against_a_scanned_value() {
    let book = indexed();
    let mut ov = MetadataOverrides {
        publisher: Some(String::new()),
        subjects: Some(vec![]),
        ..Default::default()
    };
    prune_unchanged(&mut ov, &book);
    assert_eq!(
        ov.publisher.as_deref(),
        Some(""),
        "clearing Chilton is a change"
    );
    assert_eq!(ov.subjects, Some(vec![]), "clearing the tags is a change");
}

#[test]
fn legacy_overrides_only_carry_the_fields_that_differ() {
    let book = indexed();
    let ov = legacy_overrides(
        &book,
        &LegacyFields {
            title: Some("Dune".into()),
            author: Some("F. Herbert".into()),
            series: Some(" Dune ".into()),
            series_index: Some("1".into()),
        },
    );
    assert!(ov.title.is_none());
    assert!(ov.series.is_none(), "whitespace is not an edit");
    assert_eq!(ov.series_index.as_deref(), Some("1"));
    let creators = ov.creators.expect("the renamed lead author");
    assert_eq!(creators[0].name, "F. Herbert");
    assert_eq!(
        creators[0].file_as.as_deref(),
        Some("Herbert, Frank"),
        "the lead keeps its refinements (#2355)"
    );
    assert_eq!(creators[0].id, None);
}

// ── A failed finish undoes the book ──────────────────────────────

#[tokio::test]
async fn rollback_uploaded_file_removes_the_row_the_files_and_the_cover() {
    let (app, state, pool) = fixture().await;
    let _covers = CoversDirGuard::new("review_rollback");
    let library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::file("cover", "cover.png", "image/png", TINY_PNG),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let book = committed_book(&pool, res).await;
    let uuid = book.unique_identifier.clone().unwrap();
    assert!(files_under(library.path()) >= 1);

    super::super::review::rollback_uploaded_file(
        &state,
        &uuid,
        "grace-hopper/beta-in-the-series/beta-in-the-series.epub",
    )
    .await;

    assert!(db::get_book_by_uuid(&pool, &uuid).await.unwrap().is_none());
    assert!(
        db::get_metadata_overrides(&pool, &uuid)
            .await
            .unwrap()
            .is_none(),
        "the cover override row goes with the book"
    );
    assert_eq!(
        files_under(library.path()),
        0,
        "the filed epub and its sidecar cover are gone"
    );
}

#[test]
fn trim_scalars_strips_the_whitespace_the_legacy_fields_already_lost() {
    let mut ov = MetadataOverrides {
        title: Some("  Dune ".into()),
        series: Some("Dune\n".into()),
        creators: Some(vec![Contributor {
            name: " Frank Herbert ".into(),
            ..Default::default()
        }]),
        ..Default::default()
    };
    super::super::review::trim_scalars(&mut ov);
    assert_eq!(ov.title.as_deref(), Some("Dune"));
    assert_eq!(ov.series.as_deref(), Some("Dune"));
    assert_eq!(ov.creators.unwrap()[0].name, "Frank Herbert");
}

/// The indexer may attach an upload to an existing book in another format;
/// a rollback then removes only the uploaded file, never the book it joined.
#[tokio::test]
async fn rollback_uploaded_file_leaves_a_book_the_upload_was_attached_to() {
    let (app, state, pool) = fixture().await;
    let _covers = CoversDirGuard::new("review_rollback_attached");
    let library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let book = committed_book(&pool, res).await;
    let uuid = book.unique_identifier.clone().unwrap();

    // A PDF twin with the same title and author, scanned in: the indexer
    // attaches it to the EPUB's book rather than minting a second one.
    let pdf_dir = library
        .path()
        .join("grace-hopper")
        .join("beta-in-the-series");
    let pdf_path = pdf_dir.join("beta-twin.pdf");
    std::fs::write(
        &pdf_path,
        db::test_support::build_test_pdf(&db::test_support::TestPdf {
            pages: &["Twin"],
            title: Some("Beta in the Series"),
            author: Some("Grace Hopper"),
            ..Default::default()
        }),
    )
    .unwrap();
    let scan = state.worker.post(db::worker::Task::Scan {
        library_path: library.path().to_string_lossy().to_string(),
    });
    assert!(matches!(
        state.worker.await_completion(scan).await,
        db::worker::TaskOutcome::Ok(_)
    ));
    let attached = db::get_book_by_uuid(&pool, &uuid).await.unwrap().unwrap();
    assert_eq!(attached.formats.len(), 2, "the PDF twin was attached");

    super::super::review::rollback_uploaded_file(
        &state,
        &uuid,
        "grace-hopper/beta-in-the-series/beta-twin.pdf",
    )
    .await;

    let survivor = db::get_book_by_uuid(&pool, &uuid)
        .await
        .unwrap()
        .expect("the book the upload attached to survives");
    assert_eq!(survivor.formats, vec!["EPUB".to_string()]);
    assert!(!pdf_path.exists(), "only the uploaded file is gone");
}

#[tokio::test]
async fn commit_rejects_an_overlong_legacy_title_before_filing() {
    let (app, _state, pool) = fixture().await;
    let library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let title = "x".repeat(MetadataOverrides::TITLE_MAX_LEN + 1);
    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", &title),
        Part::text("author", "Grace Hopper"),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(files_under(library.path()), 0);
}

// ── A second format attaches; the existing book keeps its record ──

/// A PDF twin of a book already in the library: the indexer attaches it as
/// a second format, the commit resolves the same uuid (through the file's
/// own scan key), the legacy title that named the folder does not rewrite
/// the book, and the edit the reader made on the form still lands.
#[tokio::test]
async fn commit_attaches_a_second_format_without_rewriting_the_existing_book() {
    let (app, _state, pool) = fixture().await;
    let _covers = CoversDirGuard::new("review_commit_attach");
    let library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .clone()
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let first = committed_book(&pool, res).await;
    let uuid = first.unique_identifier.clone().unwrap();

    let pdf = db::test_support::build_test_pdf(&db::test_support::TestPdf {
        pages: &["Twin"],
        title: Some("Beta in the Series"),
        author: Some("Grace Hopper"),
        ..Default::default()
    });
    let overrides = serde_json::json!({ "description": "From the PDF review" }).to_string();
    let (ct, body) = multipart_typed(&[
        // The reader retitled the *folder*; the book it joins is not renamed.
        Part::text("title", "Beta Twin"),
        Part::text("author", "Grace Hopper"),
        Part::text("overrides", &overrides),
        Part::file("file", "beta.pdf", "application/pdf", &pdf),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let joined = committed_book(&pool, res).await;

    assert_eq!(joined.unique_identifier.as_deref(), Some(uuid.as_str()));
    assert_eq!(
        joined.formats.len(),
        2,
        "the PDF attached as a second format"
    );
    assert_eq!(joined.title.as_deref(), Some("Beta in the Series"));
    assert_eq!(joined.description.as_deref(), Some("From the PDF review"));
    assert!(library
        .path()
        .join("grace-hopper")
        .join("beta-twin")
        .join("beta-twin.pdf")
        .is_file());
}

#[tokio::test]
async fn restore_overrides_puts_the_row_back_or_removes_one_that_did_not_exist() {
    let (app, state, pool) = fixture().await;
    let _covers = CoversDirGuard::new("review_restore");
    let _library = ebook_library(&pool).await;
    let token = admin_token(&pool).await;

    let epub = beta_epub();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Beta in the Series"),
        Part::text("author", "Grace Hopper"),
        Part::file("file", "beta.epub", "application/epub+zip", &epub),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let book = committed_book(&pool, res).await;
    let uuid = book.unique_identifier.clone().unwrap();
    let admin = db::auth::get_user_by_username(&pool, "admin")
        .await
        .unwrap()
        .expect("admin exists");

    // No row before: a write, then a restore to `None`, leaves no row.
    let later = MetadataOverrides {
        description: Some("mid-commit".into()),
        ..Default::default()
    };
    db::merge_metadata_overrides(&pool, &uuid, &later, admin.id)
        .await
        .unwrap();
    super::super::review::restore_overrides(&state, &uuid, admin.id, None, None).await;
    assert!(db::get_metadata_overrides(&pool, &uuid)
        .await
        .unwrap()
        .is_none());

    // A row before: the restore puts its exact contents back.
    let prior = MetadataOverrides {
        description: Some("before".into()),
        ..Default::default()
    };
    db::merge_metadata_overrides(&pool, &uuid, &prior, admin.id)
        .await
        .unwrap();
    let snapshot = db::get_metadata_overrides(&pool, &uuid).await.unwrap();
    db::merge_metadata_overrides(&pool, &uuid, &later, admin.id)
        .await
        .unwrap();
    super::super::review::restore_overrides(&state, &uuid, admin.id, snapshot, None).await;
    let (restored, has_cover) = db::get_metadata_overrides(&pool, &uuid)
        .await
        .unwrap()
        .expect("the prior row is back");
    assert_eq!(restored.description.as_deref(), Some("before"));
    assert!(!has_cover);

    // A prior override cover: the replacement file is overwritten with the
    // snapshotted bytes, not merely left flagged.
    db::write_override_cover(&uuid, "image/png", TINY_PNG).unwrap();
    db::upsert_metadata_overrides(&pool, &uuid, &prior, true, admin.id)
        .await
        .unwrap();
    let snapshot = db::get_metadata_overrides(&pool, &uuid).await.unwrap();
    let prior_cover = db::get_cover(&pool, book.id).await.unwrap();
    let prior_bytes = prior_cover.clone().expect("a prior override cover").1;
    let mut replacement = TINY_PNG.to_vec();
    replacement.extend_from_slice(b"\0tail");
    db::write_override_cover(&uuid, "image/png", &replacement).unwrap();
    assert_ne!(
        db::get_cover(&pool, book.id).await.unwrap().unwrap().1,
        prior_bytes
    );
    super::super::review::restore_overrides(&state, &uuid, admin.id, snapshot, prior_cover).await;
    assert_eq!(
        db::get_cover(&pool, book.id).await.unwrap().unwrap().1,
        prior_bytes,
        "the snapshotted cover bytes are back"
    );
}

/// The attach can cross libraries: an audiobook uploaded under the audiobook
/// root joins the EPUB's book under the ebook root, so the commit must
/// resolve the uuid through the file's own root, not the book's.
#[tokio::test]
async fn commit_resolves_an_audiobook_attached_across_libraries() {
    let (app, _state, pool) = fixture().await;
    let _covers = CoversDirGuard::new("review_commit_cross_library");
    let ebooks = tempfile::tempdir().expect("temp ebook library");
    let audiobooks = tempfile::tempdir().expect("temp audiobook library");
    db::set_settings(
        &pool,
        &Settings {
            ebook_library_path: Some(ebooks.path().to_string_lossy().to_string()),
            audiobook_library_path: Some(audiobooks.path().to_string_lossy().to_string()),
            scan_interval_hours: None,
        },
    )
    .await
    .expect("set both library paths");
    let token = admin_token(&pool).await;

    let epub = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../test_data/epubs/generated/immersive-voyage.epub"),
    )
    .unwrap();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Immersive Voyage"),
        Part::text("author", "Alan Turing"),
        Part::file(
            "file",
            "immersive-voyage.epub",
            "application/epub+zip",
            &epub,
        ),
    ]);
    let res = app
        .clone()
        .oneshot(post_multipart("/api/uploads/ebooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let first = committed_book(&pool, res).await;
    let uuid = first.unique_identifier.clone().unwrap();

    let mp3 = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../test_data/audiobooks/generated/alan_turing_solo/immersive_voyage.mp3"),
    )
    .unwrap();
    let (ct, body) = multipart_typed(&[
        Part::text("title", "Immersive Voyage"),
        Part::text("author", "Alan Turing"),
        Part::file("file", "immersive_voyage.mp3", "audio/mpeg", &mp3),
    ]);
    let res = app
        .oneshot(post_multipart("/api/uploads/audiobooks", &token, &ct, body))
        .await
        .expect("request should succeed");
    let joined = committed_book(&pool, res).await;

    assert_eq!(joined.unique_identifier.as_deref(), Some(uuid.as_str()));
    assert_eq!(
        joined.formats.len(),
        2,
        "the audiobook attached as a second format"
    );
}
