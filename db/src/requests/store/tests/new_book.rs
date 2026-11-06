//! Starting a request on a book the library does not have yet: the book and the request land together or not at all.

use omnibus_shared::scan::ScanOutcome;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::metadata_lookup::{MetadataLookupConfig, ProviderKeys};
use crate::scan::resolve_meta;
use crate::test_support::{count_rows, external_meta, loopback_cover_config, CoversTempDir};

use super::*;

const BOOKS: &str = "SELECT COUNT(*) FROM books";

mod start_for_new_book {
    use super::*;

    #[tokio::test]
    async fn records_a_looking_request_on_a_new_fileless_book() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;

        let row = start_for_new_book(
            &pool,
            ada,
            &external_meta("Piranesi"),
            RequestKind::Ebook,
            MAX_LIVE,
        )
        .await
        .unwrap();

        assert_eq!(row.user_id, ada);
        assert_eq!(row.state, RequestState::Looking);
        let book = crate::books::get_book_by_uuid(&pool, &row.book_uuid)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(book.title.as_deref(), Some("Piranesi"));
        assert!(book.formats.is_empty());
        assert_eq!(get(&pool, row.id).await.unwrap(), Some(row));
        assert_eq!(
            count_rows(&pool, "SELECT COUNT(*) FROM wishlist_entries").await,
            0
        );
        assert_eq!(
            count_rows(&pool, "SELECT COUNT(*) FROM physical_copies").await,
            0
        );
    }

    #[tokio::test]
    async fn makes_no_book_when_the_reader_is_at_the_live_cap() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;
        start(&pool, ada, "book-1", RequestKind::Ebook, 1)
            .await
            .unwrap();

        let refused = start_for_new_book(
            &pool,
            ada,
            &external_meta("Piranesi"),
            RequestKind::Ebook,
            1,
        )
        .await;

        assert!(matches!(refused, Err(RequestError::TooManyLive)));
        assert_eq!(count_rows(&pool, BOOKS).await, 0);
        assert_eq!(request_count(&pool).await, 1);
    }

    #[tokio::test]
    async fn fetches_no_cover_when_the_reader_is_at_the_live_cap() {
        let pool = pool().await;
        let _covers = CoversTempDir::new("start_for_new_book_at_cap");
        let ada = seed_user(&pool, "ada").await;
        start(&pool, ada, "book-1", RequestKind::Ebook, 1)
            .await
            .unwrap();
        let origin = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/cover.jpg"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&origin)
            .await;
        let mut meta = external_meta("Piranesi");
        meta.cover_url = Some(format!("{}/cover.jpg", origin.uri()));

        let refused = start_for_new_book_with(
            &pool,
            ada,
            &meta,
            RequestKind::Ebook,
            1,
            &loopback_cover_config(),
        )
        .await;

        assert!(matches!(refused, Err(RequestError::TooManyLive)));
        assert!(origin.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn answers_with_a_db_error_when_the_pool_is_closed() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;
        pool.close().await;

        let failed = start_for_new_book(
            &pool,
            ada,
            &external_meta("Piranesi"),
            RequestKind::Ebook,
            MAX_LIVE,
        )
        .await;

        assert!(matches!(failed, Err(RequestError::Db(_))));
    }

    #[tokio::test]
    async fn makes_a_book_that_resolve_meta_matches_instead_of_a_second_one() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;
        let meta = external_meta("Piranesi");
        let row = start_for_new_book(&pool, ada, &meta, RequestKind::Ebook, MAX_LIVE)
            .await
            .unwrap();
        // No provider is reached: the exact ISBN rung answers first.
        let offline = MetadataLookupConfig {
            openlibrary_base: crate::test_support::closed_port_url(),
            googlebooks_base: crate::test_support::closed_port_url(),
            hardcover_base: crate::test_support::closed_port_url(),
            keys: ProviderKeys::default(),
            throttle: crate::metadata_lookup::ThrottleTracker::fresh(),
            timeout: std::time::Duration::from_secs(1),
        };

        let outcome = resolve_meta(&pool, ada, &meta, &offline).await.unwrap();

        match outcome {
            ScanOutcome::InLibraryUnowned { book } => assert_eq!(book.uuid, row.book_uuid),
            other => panic!("expected the made book, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn makes_a_book_the_palette_hides_like_a_wishlist_only_one() {
        let pool = pool().await;
        let _covers = CoversTempDir::new("start_for_new_book_palette");
        let ada = seed_user(&pool, "ada").await;
        start_for_new_book(
            &pool,
            ada,
            &external_meta("Piranesi"),
            RequestKind::Ebook,
            MAX_LIVE,
        )
        .await
        .unwrap();

        let found = crate::palette::search_palette(&pool, "/lib", "piranesi")
            .await
            .unwrap();

        assert!(found.books.is_empty(), "books arm: {found:?}");
        assert!(found.authors.is_empty(), "authors arm: {found:?}");
    }
}
