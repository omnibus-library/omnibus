//! What a rung may offer and how it names it: the liveness gate that keeps an
//! orphan `books` row (no file, copy or wish) off every rung, the
//! effective-metadata projection the confirm card renders, the author
//! separator that keeps a sort-form name whole, and the `has_files` flag the
//! confirm subtitle words itself from.

use omnibus_shared::physical::WishlistSource;
use omnibus_shared::scan::ScanOutcome;
use sqlx::SqlitePool;
use wiremock::MockServer;

use crate::physical::{add_physical_copy, add_wishlist_entry, create_fileless_book, FilelessBook};

use super::super::*;
use super::{
    config_for, mount_ol_hit, override_title_author, pool, seed_book, seed_user, ISBN, USER_ID,
};

/// Mint a fileless book with one author and no copy, cover or wish — the
/// shape an orphan row takes, and the base every physical-only shape adds to.
async fn seed_fileless(pool: &SqlitePool, title: &str, author: &str, isbn: Option<&str>) -> String {
    create_fileless_book(
        pool,
        FilelessBook {
            title: title.to_string(),
            authors: vec![author.to_string()],
            isbn: isbn.map(str::to_string),
            pubdate: None,
            description: None,
            cover: None,
        },
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn resolve_scan_never_offers_an_orphan_row_on_any_rung() {
    let pool = pool().await;
    // Publishes the ISBN *and* matches the provider's title/author, so both
    // the exact rung and every norm pass would take it — but it has no file,
    // no copy and no wish, so no reader surface shows it.
    seed_fileless(&pool, "Piranesi", "Susanna Clarke", Some(ISBN)).await;
    let server = MockServer::start().await;
    mount_ol_hit(&server, "Piranesi", "Susanna Clarke").await;

    let outcome = resolve_scan(&pool, USER_ID, ISBN, &config_for(&server))
        .await
        .unwrap();

    assert!(
        matches!(outcome, ScanOutcome::NotInLibrary { .. }),
        "an orphan row must fall through to the online outcome, got {outcome:?}"
    );
}

#[tokio::test]
async fn resolve_scan_still_offers_a_wishlisted_fileless_book_on_the_isbn_rung() {
    let pool = pool().await;
    let user = seed_user(&pool, "wisher").await;
    let uuid = seed_fileless(&pool, "Piranesi", "Susanna Clarke", Some(ISBN)).await;
    add_wishlist_entry(&pool, user, &uuid, WishlistSource::Manual)
        .await
        .unwrap();
    let server = MockServer::start().await; // must not be hit

    let outcome = resolve_scan(&pool, user, ISBN, &config_for(&server))
        .await
        .unwrap();

    match outcome {
        ScanOutcome::OnWishlist { book } => {
            assert_eq!(book.uuid, uuid);
            assert!(!book.has_files);
        }
        other => panic!("expected OnWishlist, got {other:?}"),
    }
}

#[tokio::test]
async fn resolve_scan_offers_a_paper_only_book_as_a_close_match_without_a_file() {
    let pool = pool().await;
    let uuid = seed_fileless(&pool, "Piranesi", "Susanna Clarke", None).await;
    add_physical_copy(&pool, &uuid, None, None, None)
        .await
        .unwrap();
    let server = MockServer::start().await;
    mount_ol_hit(&server, "Piranesi", "Susanna Clarke").await;

    let outcome = resolve_scan(&pool, USER_ID, ISBN, &config_for(&server))
        .await
        .unwrap();

    match outcome {
        ScanOutcome::CloseMatch { book, .. } => {
            assert_eq!(book.uuid, uuid);
            assert!(book.has_physical);
            assert!(
                !book.has_files,
                "a paper-only book must not read as digital"
            );
        }
        other => panic!("expected CloseMatch, got {other:?}"),
    }
}

#[tokio::test]
async fn resolve_scan_reports_has_files_for_a_file_backed_book() {
    let pool = pool().await;
    seed_book(&pool, "u1", "Effective Java", "Joshua Bloch", Some(ISBN)).await;
    let server = MockServer::start().await; // must not be hit

    let outcome = resolve_scan(&pool, USER_ID, ISBN, &config_for(&server))
        .await
        .unwrap();

    match outcome {
        ScanOutcome::InLibraryUnowned { book } => assert!(book.has_files),
        other => panic!("expected InLibraryUnowned, got {other:?}"),
    }
}

#[tokio::test]
async fn resolve_scan_keeps_a_comma_in_a_sort_form_author_name() {
    let pool = pool().await;
    // The stored creator is the file's sort form; split on ", " it used to
    // arrive as the two people "Weir" and "Andy" (#2460).
    seed_book(&pool, "u1", "Project Hail Mary", "Weir, Andy", Some(ISBN)).await;
    let server = MockServer::start().await; // must not be hit

    let outcome = resolve_scan(&pool, USER_ID, ISBN, &config_for(&server))
        .await
        .unwrap();

    match outcome {
        ScanOutcome::InLibraryUnowned { book } => {
            assert_eq!(book.authors, vec!["Weir, Andy".to_string()]);
        }
        other => panic!("expected InLibraryUnowned, got {other:?}"),
    }
}

#[tokio::test]
async fn resolve_scan_names_an_exact_hit_by_its_effective_title_and_author() {
    let pool = pool().await;
    let user = seed_user(&pool, "editor").await;
    seed_book(
        &pool,
        "u1",
        "Weir, Andy - Project Hail Mary",
        "Weir, Andy",
        Some(ISBN),
    )
    .await;
    override_title_author(
        &pool,
        "u1",
        user,
        Some("Project Hail Mary"),
        Some("Andy Weir"),
    )
    .await;
    let server = MockServer::start().await; // must not be hit

    let outcome = resolve_scan(&pool, USER_ID, ISBN, &config_for(&server))
        .await
        .unwrap();

    match outcome {
        ScanOutcome::InLibraryUnowned { book } => {
            assert_eq!(book.title, "Project Hail Mary");
            assert_eq!(book.authors, vec!["Andy Weir".to_string()]);
        }
        other => panic!("expected InLibraryUnowned, got {other:?}"),
    }
}

#[tokio::test]
async fn resolve_scan_names_a_close_match_by_its_effective_title_and_author() {
    let pool = pool().await;
    let user = seed_user(&pool, "editor").await;
    // No ISBN, so the exact rung misses and the override-aware norm arm is
    // what finds it — and what must render it the way the detail page does.
    seed_book(
        &pool,
        "u1",
        "Weir, Andy - Project Hail Mary",
        "Weir, Andy",
        None,
    )
    .await;
    override_title_author(
        &pool,
        "u1",
        user,
        Some("Project Hail Mary"),
        Some("Andy Weir"),
    )
    .await;
    let server = MockServer::start().await;
    mount_ol_hit(&server, "Project Hail Mary", "Andy Weir").await;

    let outcome = resolve_scan(&pool, USER_ID, ISBN, &config_for(&server))
        .await
        .unwrap();

    match outcome {
        ScanOutcome::CloseMatch { book, .. } => {
            assert_eq!(book.uuid, "u1");
            assert_eq!(book.title, "Project Hail Mary");
            assert_eq!(book.authors, vec!["Andy Weir".to_string()]);
        }
        other => panic!("expected CloseMatch, got {other:?}"),
    }
}

/// Corrupt the seeded book's override blob in place, the way
/// `search_palette_tags_tolerate_a_corrupt_overrides_blob` does.
async fn corrupt_overrides(pool: &SqlitePool, uuid: &str) {
    sqlx::query(
        "INSERT INTO metadata_overrides (book_uuid, overrides) VALUES (?1, '{not json')
         ON CONFLICT(book_uuid) DO UPDATE SET overrides = '{not json'",
    )
    .bind(uuid)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn resolve_scan_falls_back_to_the_scanned_fields_on_a_corrupt_override_blob() {
    let pool = pool().await;
    seed_book(&pool, "u1", "Effective Java", "Joshua Bloch", Some(ISBN)).await;
    corrupt_overrides(&pool, "u1").await;
    let server = MockServer::start().await; // must not be hit

    let outcome = resolve_scan(&pool, USER_ID, ISBN, &config_for(&server))
        .await
        .expect("a corrupt blob must fail the override, not the lookup");

    match outcome {
        ScanOutcome::InLibraryUnowned { book } => {
            assert_eq!(book.title, "Effective Java");
            assert_eq!(book.authors, vec!["Joshua Bloch".to_string()]);
        }
        other => panic!("expected InLibraryUnowned, got {other:?}"),
    }
}

#[tokio::test]
async fn resolve_scan_still_offers_a_close_match_whose_override_blob_is_corrupt() {
    let pool = pool().await;
    // No ISBN, so the row is found by the norm rung's override arm — the one
    // that joins the corrupt blob directly.
    seed_book(&pool, "u1", "Effective Java", "Joshua Bloch", None).await;
    corrupt_overrides(&pool, "u1").await;
    let server = MockServer::start().await;
    mount_ol_hit(&server, "Effective Java", "Joshua Bloch").await;

    let outcome = resolve_scan(&pool, USER_ID, ISBN, &config_for(&server))
        .await
        .expect("a corrupt blob must fail the override, not the lookup");

    match outcome {
        ScanOutcome::CloseMatch { book, .. } => {
            assert_eq!(book.uuid, "u1");
            assert_eq!(book.title, "Effective Java");
        }
        other => panic!("expected CloseMatch, got {other:?}"),
    }
}
