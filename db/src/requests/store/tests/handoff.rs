//! What a request hands the download client: its own tag, and whether its book may be offered a download's cover.

use crate::requests::test_support::seed_picked;
use crate::test_support::external_meta;

use super::*;

mod begin_download {
    use super::*;

    fn uuid_of(tag: &str) -> Option<uuid::Uuid> {
        uuid::Uuid::parse_str(tag.strip_prefix("omnibus-")?).ok()
    }

    #[tokio::test]
    async fn tags_the_download_with_a_uuid_of_its_own() {
        let pool = pool().await;
        let id = seed_picked(&pool, "ada", "book-1", RequestKind::Ebook, "chosen").await;

        let (tag, _) = begin_download(&pool, id).await.unwrap().unwrap();

        assert!(uuid_of(&tag).is_some(), "{tag}");
        assert_eq!(get(&pool, id).await.unwrap().unwrap().client_tag, Some(tag));
    }

    #[tokio::test]
    async fn gives_two_requests_with_the_same_id_in_fresh_databases_different_tags() {
        let (first, second) = (pool().await, pool().await);
        let a = seed_picked(&first, "ada", "book-1", RequestKind::Ebook, "chosen").await;
        let b = seed_picked(&second, "ada", "book-1", RequestKind::Ebook, "chosen").await;

        let (tag_a, _) = begin_download(&first, a).await.unwrap().unwrap();
        let (tag_b, _) = begin_download(&second, b).await.unwrap().unwrap();

        assert_eq!(a, b);
        assert_ne!(tag_a, tag_b);
    }

    #[tokio::test]
    async fn keeps_the_tag_it_gave_when_the_hand_off_is_retried() {
        let pool = pool().await;
        let id = seed_picked(&pool, "ada", "book-1", RequestKind::Ebook, "chosen").await;
        let (first, _) = begin_download(&pool, id).await.unwrap().unwrap();

        let (again, _) = begin_download(&pool, id).await.unwrap().unwrap();

        assert_eq!(again, first);
    }
}

mod offers_cover {
    use super::*;

    #[tokio::test]
    async fn is_on_for_a_request_on_a_book_nobody_made_for_a_request() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;

        let started = start(&pool, ada, "book-1", RequestKind::Ebook, MAX_LIVE)
            .await
            .unwrap();

        assert!(started.request.offers_cover);
    }

    #[tokio::test]
    async fn stays_off_for_a_new_request_on_a_book_made_for_a_request() {
        let pool = pool().await;
        let ada = seed_user(&pool, "ada").await;
        let bob = seed_user(&pool, "bob").await;
        let first = start_for_new_book(
            &pool,
            ada,
            &external_meta("Piranesi"),
            RequestKind::Ebook,
            MAX_LIVE,
        )
        .await
        .unwrap();

        let again = start(&pool, bob, &first.book_uuid, RequestKind::Ebook, MAX_LIVE)
            .await
            .unwrap();

        assert!(!first.offers_cover);
        assert!(!again.request.offers_cover);
    }
}
