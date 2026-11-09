//! What a request hands the download client: the hash it is found by, and whether its book may be offered a download's cover.

use crate::requests::test_support::{hash, magnet, seed_picked, update};
use crate::test_support::external_meta;

use super::*;

mod pick_link {
    use super::*;

    #[tokio::test]
    async fn gives_the_link_of_the_pick_while_the_request_waits_to_be_added() {
        let pool = pool().await;
        let id = seed_picked(&pool, "ada", "book-1", RequestKind::Ebook, "chosen").await;

        let link = pick_link(&pool, id).await.unwrap();

        assert_eq!(link, Some(magnet(id)));
    }

    #[tokio::test]
    async fn gives_none_once_the_request_is_no_longer_waiting_to_be_added() {
        let pool = pool().await;
        let id = seed_picked(&pool, "ada", "book-1", RequestKind::Ebook, "on_its_way").await;

        assert_eq!(pick_link(&pool, id).await.unwrap(), None);
    }
}

mod mark_on_its_way {
    use super::*;

    #[tokio::test]
    async fn records_the_hash_and_whether_the_client_already_held_the_torrent() {
        let pool = pool().await;
        let id = seed_picked(&pool, "ada", "book-1", RequestKind::Ebook, "chosen").await;

        let moved = mark_on_its_way(&pool, id, &hash(id), true, 100)
            .await
            .unwrap();

        assert!(moved);
        let after = get(&pool, id).await.unwrap().unwrap();
        assert_eq!(after.state, RequestState::OnItsWay);
        assert_eq!(after.client_hash, Some(hash(id)));
        assert!(after.client_adopted);
    }

    #[tokio::test]
    async fn records_nothing_and_says_so_when_the_request_was_cancelled_meanwhile() {
        let pool = pool().await;
        let id = seed_picked(&pool, "ada", "book-1", RequestKind::Ebook, "chosen").await;
        update(&pool, id, "state = 'cancelled'").await;

        let moved = mark_on_its_way(&pool, id, &hash(id), false, 100)
            .await
            .unwrap();

        assert!(!moved);
        assert_eq!(get(&pool, id).await.unwrap().unwrap().client_hash, None);
    }
}

mod mark_ready {
    use super::*;

    /// A request on its way whose download was added by Omnibus, or `adopted` by the client.
    async fn downloaded(pool: &SqlitePool, adopted: bool) -> (i64, Option<i64>) {
        let id = seed_picked(pool, "ada", "book-1", RequestKind::Ebook, "on_its_way").await;
        let set = format!("client_hash = '{}', client_adopted = {adopted}", hash(id));
        update(pool, id, &set).await;
        (id, get(pool, id).await.unwrap().unwrap().chosen_result_id)
    }

    #[tokio::test]
    async fn queues_the_download_for_removal_when_asked() {
        let pool = pool().await;
        let (id, chosen) = downloaded(&pool, false).await;

        mark_ready(&pool, id, chosen, true).await.unwrap();

        let after = get(&pool, id).await.unwrap().unwrap();
        assert_eq!(after.state, RequestState::Ready);
        assert_eq!(after.remove_hash, Some(hash(id)));
        assert_eq!(after.remove_since, None);
    }

    #[tokio::test]
    async fn changes_nothing_but_the_state_when_not_asked_to_remove() {
        let pool = pool().await;
        let (id, chosen) = downloaded(&pool, false).await;

        mark_ready(&pool, id, chosen, false).await.unwrap();

        let after = get(&pool, id).await.unwrap().unwrap();
        assert_eq!(after.state, RequestState::Ready);
        assert_eq!(after.remove_hash, None);
    }

    #[tokio::test]
    async fn queues_nothing_for_a_download_the_client_already_held() {
        let pool = pool().await;
        let (id, chosen) = downloaded(&pool, true).await;

        mark_ready(&pool, id, chosen, true).await.unwrap();

        assert_eq!(get(&pool, id).await.unwrap().unwrap().remove_hash, None);
    }

    #[tokio::test]
    async fn keeps_a_removal_that_is_already_pending() {
        let pool = pool().await;
        let (id, chosen) = downloaded(&pool, false).await;
        update(&pool, id, "remove_hash = 'earlier', remove_since = 5").await;

        mark_ready(&pool, id, chosen, true).await.unwrap();

        let after = get(&pool, id).await.unwrap().unwrap();
        assert_eq!(after.remove_hash.as_deref(), Some("earlier"));
        assert_eq!(after.remove_since, Some(5));
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

    #[tokio::test]
    async fn is_on_again_once_the_book_has_a_physical_copy() {
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
        crate::add_physical_copy(&pool, &first.book_uuid, None, None, None)
            .await
            .unwrap();

        let again = start(&pool, bob, &first.book_uuid, RequestKind::Ebook, MAX_LIVE)
            .await
            .unwrap();

        assert!(again.request.offers_cover);
    }
}
