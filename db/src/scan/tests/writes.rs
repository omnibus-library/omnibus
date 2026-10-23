//! The write composition: `add_physical_only_with` creating a fileless
//! book with a copy and a provider cover (allowlisted host, fetch failure
//! tolerated), and `wishlist_add_with` by uuid or by picked metadata with
//! its missing-target and unresolvable-uuid errors.

use omnibus_shared::metadata_lookup::MetadataProvider;
use omnibus_shared::physical::WishlistSource;
use omnibus_shared::scan::ScanOutcome;
use sqlx::SqlitePool;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::author_photos::RemoteImageConfig;
use crate::covers::find_cover_file;
use crate::metadata_lookup::provider_cover_image_config;
use crate::physical::{
    create_fileless_book, list_physical_copies, list_wishlist, FilelessBook, PhysicalError,
};
use crate::test_support::{count_rows, CoversTempDir};

use super::super::resolve::{add_physical_only_with, wishlist_add_with};
use super::super::*;
use super::{config_for, has_cover, picked_meta, pool, seed_book, seed_user, ISBN, USER_ID};

/// [`provider_cover_image_config`] aimed at a loopback `wiremock` origin: the
/// catalog allowlist plus `127.0.0.1`, and plaintext permitted, since a mock
/// server is neither publicly routable nor HTTPS. Every other gate — the
/// redirect budget above all — is production's, so what these tests exercise
/// is the config the check-in path actually ships.
fn loopback_cover_config() -> RemoteImageConfig {
    let mut config = provider_cover_image_config(true);
    config.require_https = false;
    config.host_allowlist.push("127.0.0.1".into());
    config
}

/// Serve a cover the way Open Library's CDN does: a 302 before the bytes.
async fn mount_redirected_cover(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/cover.jpg"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", "/cdn/cover.jpg"))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/cdn/cover.jpg"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "image/jpeg")
                .set_body_bytes(b"\xFF\xD8\xFFcoverbytes".to_vec()),
        )
        .mount(server)
        .await;
}

#[tokio::test]
async fn add_physical_only_creates_fileless_book_with_copy_and_provider_cover() {
    let pool = pool().await;
    let _covers = CoversTempDir::new("add_physical_only_cover");
    let origin = MockServer::start().await;
    mount_redirected_cover(&origin).await;
    let mut meta = picked_meta("Print Only", "Jane Doe", ISBN);
    meta.cover_url = Some(format!("{}/cover.jpg", origin.uri()));

    let uuid = add_physical_only_with(
        &pool,
        &meta,
        Some("first ed"),
        None,
        &loopback_cover_config(),
    )
    .await
    .unwrap();

    let copies = list_physical_copies(&pool, &uuid).await.unwrap();
    assert_eq!(copies.len(), 1);
    assert_eq!(copies[0].isbn.as_deref(), Some(ISBN));
    // The cover the check-in card rendered survives the redirect hop onto disk.
    assert!(has_cover(&pool, &uuid).await);
    assert!(find_cover_file(&uuid).is_some());
    // The book resolves by its ISBN now (exact rung).
    let server = MockServer::start().await;
    let outcome = resolve_scan(&pool, USER_ID, ISBN, &config_for(&server))
        .await
        .unwrap();
    assert!(matches!(outcome, ScanOutcome::AlreadyOwned { .. }));
}

#[tokio::test]
async fn add_physical_only_refuses_a_cover_url_outside_the_provider_host_allowlist() {
    let pool = pool().await;
    let _covers = CoversTempDir::new("add_physical_only_off_catalog");
    let origin = MockServer::start().await;
    mount_redirected_cover(&origin).await;
    // The same reachable origin under a host the catalog never publishes, so
    // the allowlist is the only gate that can account for the refusal.
    let mut meta = picked_meta("Off Catalog", "Jane Doe", ISBN);
    meta.cover_url = Some(format!(
        "http://localhost:{}/cover.jpg",
        origin.address().port()
    ));

    let uuid = add_physical_only_with(&pool, &meta, None, None, &loopback_cover_config())
        .await
        .unwrap();

    assert!(!has_cover(&pool, &uuid).await);
    assert!(find_cover_file(&uuid).is_none());
    // Refused before any request left the process, not after reading bytes.
    assert!(origin.received_requests().await.unwrap().is_empty());
    // Still a book with a copy — a dropped cover must not fail the check-in.
    assert_eq!(list_physical_copies(&pool, &uuid).await.unwrap().len(), 1);
}

#[tokio::test]
async fn add_physical_only_creates_the_book_when_the_cover_fetch_fails() {
    let pool = pool().await;
    let _covers = CoversTempDir::new("add_physical_only_cover_404");
    let origin = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/cover.jpg"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&origin)
        .await;
    let mut meta = picked_meta("Missing Cover", "Jane Doe", ISBN);
    meta.cover_url = Some(format!("{}/cover.jpg", origin.uri()));

    let uuid = add_physical_only_with(&pool, &meta, None, None, &loopback_cover_config())
        .await
        .unwrap();

    assert!(!has_cover(&pool, &uuid).await);
    assert_eq!(list_physical_copies(&pool, &uuid).await.unwrap().len(), 1);
}

#[tokio::test]
async fn wishlist_add_by_book_uuid() {
    let pool = pool().await;
    seed_book(&pool, "u1", "Effective Java", "Joshua Bloch", Some(ISBN)).await;
    let user = seed_user(&pool, "reader").await;

    let uuid = wishlist_add(&pool, user, Some("u1"), None, WishlistSource::Scan)
        .await
        .unwrap();
    assert_eq!(uuid, "u1");
    assert_eq!(list_wishlist(&pool, user).await.unwrap().len(), 1);
}

#[tokio::test]
async fn wishlist_add_by_book_uuid_lands_on_a_book_only_another_reader_wants() {
    let pool = pool().await;
    let first = seed_user(&pool, "first").await;
    let second = seed_user(&pool, "second").await;
    let uuid = create_fileless_book(
        &pool,
        FilelessBook {
            title: "Wanted".to_string(),
            authors: vec!["Jane Doe".to_string()],
            isbn: Some(ISBN.to_string()),
            pubdate: None,
            description: None,
            cover: None,
        },
    )
    .await
    .unwrap();
    wishlist_add(&pool, first, Some(&uuid), None, WishlistSource::Manual)
        .await
        .unwrap();
    let books_before = count_rows(&pool, "SELECT COUNT(*) FROM books").await;

    let landed = wishlist_add(&pool, second, Some(&uuid), None, WishlistSource::Scan)
        .await
        .unwrap();

    assert_eq!(landed, uuid);
    assert_eq!(
        count_rows(&pool, "SELECT COUNT(*) FROM books").await,
        books_before
    );
    let wishes = list_wishlist(&pool, second).await.unwrap();
    assert_eq!(wishes.len(), 1);
    assert_eq!(wishes[0].book_uuid, uuid);
}

#[tokio::test]
async fn wishlist_add_by_meta_creates_fileless_book_with_provider_cover() {
    let pool = pool().await;
    let _covers = CoversTempDir::new("wishlist_add_cover");
    let user = seed_user(&pool, "reader").await;
    let origin = MockServer::start().await;
    mount_redirected_cover(&origin).await;
    let mut meta = picked_meta("Wishlisted", "Jane Doe", ISBN);
    meta.source = MetadataProvider::GoogleBooks;
    meta.cover_url = Some(format!("{}/cover.jpg", origin.uri()));

    let uuid = wishlist_add_with(
        &pool,
        user,
        None,
        Some(&meta),
        WishlistSource::Detail,
        &loopback_cover_config(),
    )
    .await
    .unwrap();

    assert!(has_cover(&pool, &uuid).await);
    assert!(find_cover_file(&uuid).is_some());
    let list = list_wishlist(&pool, user).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].book_uuid, uuid);
    // Fileless book exists but has no physical copy (pure wishlist entry).
    assert!(list_physical_copies(&pool, &uuid).await.unwrap().is_empty());
}

#[tokio::test]
async fn wishlist_add_errors_without_target() {
    let pool = pool().await;
    let user = seed_user(&pool, "reader").await;
    let err = wishlist_add(&pool, user, None, None, WishlistSource::Manual)
        .await
        .unwrap_err();
    assert!(matches!(err, ScanError::MissingWishlistTarget));
}

#[tokio::test]
async fn wishlist_add_surfaces_physical_error_when_book_uuid_is_unresolvable() {
    let pool = pool().await;
    let user = seed_user(&pool, "reader").await;

    // No book carries this uuid, so add_wishlist_entry's canonical-uuid
    // resolution fails — the real code path behind ScanError::Physical.
    let err = wishlist_add(&pool, user, Some("nope"), None, WishlistSource::Manual)
        .await
        .unwrap_err();
    assert!(
        matches!(err, ScanError::Physical(PhysicalError::BookNotFound)),
        "got {err:?}"
    );
}

// ── what the created entry keeps from the candidate ──────────────

/// A title-search hit: an Open Library work card carries the work's first
/// publication year and a series statement, and leaves the edition's own year empty.
fn title_hit_meta() -> omnibus_shared::ExternalBookMeta {
    let mut meta = picked_meta("The Obelisk Gate", "N. K. Jemisin", ISBN);
    meta.year = None;
    meta.first_publish_year = Some(2016);
    meta.series = Some("The Broken Earth #2".into());
    meta.pages = Some(410);
    meta
}

async fn stored_book(pool: &SqlitePool, uuid: &str) -> omnibus_shared::EbookMetadata {
    crate::get_book_by_uuid(pool, uuid).await.unwrap().unwrap()
}

#[tokio::test]
async fn wishlist_add_publishes_the_book_in_the_works_first_publication_year() {
    let pool = pool().await;
    let user = seed_user(&pool, "reader").await;

    let uuid = wishlist_add(
        &pool,
        user,
        None,
        Some(&title_hit_meta()),
        WishlistSource::Search,
    )
    .await
    .unwrap();

    assert_eq!(
        stored_book(&pool, &uuid).await.published.as_deref(),
        Some("2016")
    );
}

#[tokio::test]
async fn wishlist_add_links_the_series_named_by_the_candidate_and_reads_its_index() {
    let pool = pool().await;
    let user = seed_user(&pool, "reader").await;

    let uuid = wishlist_add(
        &pool,
        user,
        None,
        Some(&title_hit_meta()),
        WishlistSource::Search,
    )
    .await
    .unwrap();

    let book = stored_book(&pool, &uuid).await;
    assert_eq!(book.series.as_deref(), Some("The Broken Earth"));
    assert_eq!(book.series_index.as_deref(), Some("2"));
    assert_eq!(
        book.series_id,
        Some(
            sqlx::query_scalar("SELECT id FROM series WHERE name = 'The Broken Earth'")
                .fetch_one(&pool)
                .await
                .unwrap()
        )
    );
    let sort: Option<String> = sqlx::query_scalar("SELECT series_sort FROM books WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sort.as_deref(), Some("The Broken Earth"));
}

#[tokio::test]
async fn add_physical_only_stores_the_candidates_pages_as_an_override_by_the_filing_user() {
    let pool = pool().await;
    let user = seed_user(&pool, "reader").await;

    let uuid = add_physical_only_with(
        &pool,
        &title_hit_meta(),
        None,
        Some(user),
        &loopback_cover_config(),
    )
    .await
    .unwrap();

    assert_eq!(stored_book(&pool, &uuid).await.print_pages, Some(410));
    let by: Option<i64> =
        sqlx::query_scalar("SELECT updated_by FROM metadata_overrides WHERE book_uuid = ?")
            .bind(&uuid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(by, Some(user));
}

#[tokio::test]
async fn add_physical_only_stores_no_pages_when_nobody_filed_the_copy() {
    let pool = pool().await;

    let uuid = add_physical_only_with(
        &pool,
        &title_hit_meta(),
        None,
        None,
        &loopback_cover_config(),
    )
    .await
    .unwrap();

    assert_eq!(stored_book(&pool, &uuid).await.print_pages, None);
    assert_eq!(
        count_rows(&pool, "SELECT COUNT(*) FROM metadata_overrides").await,
        0
    );
}

#[tokio::test]
async fn add_physical_only_leaves_no_book_behind_when_the_copy_cannot_be_filed() {
    let pool = pool().await;

    // No such reader: the copy's filer is a foreign key, so the write fails.
    let err = add_physical_only_with(
        &pool,
        &title_hit_meta(),
        None,
        Some(9_999),
        &loopback_cover_config(),
    )
    .await
    .unwrap_err();

    assert!(matches!(err, ScanError::Physical(_) | ScanError::Sqlx(_)));
    assert_eq!(count_rows(&pool, "SELECT COUNT(*) FROM books").await, 0);
}
