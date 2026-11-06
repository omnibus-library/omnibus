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

mod migration_0119 {

    /// Version of `0119_book_requests_client_hash.sql`.
    const VERSION: i64 = 119;

    #[tokio::test]
    async fn hands_a_download_over_again_and_drops_the_tags_it_cannot_read_as_hashes() {
        static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for m in MIGRATOR.iter().filter(|m| m.version < VERSION) {
            sqlx::raw_sql(&m.sql).execute(&pool).await.unwrap();
        }
        sqlx::raw_sql(
            "INSERT INTO users (id, username, password_hash) VALUES (1, 'ada', '!x');
             INSERT INTO book_requests (id, book_uuid, user_id, kind, state, client_tag, remove_tag, remove_since, progress, moved_at)
             VALUES (1, 'b1', 1, 'ebook', 'on_its_way', 'omnibus-1-1', NULL, NULL, 0.5, 10),
                    (2, 'b2', 1, 'ebook', 'cancelled', NULL, 'omnibus-2-2', 20, NULL, NULL);",
        )
        .execute(&pool)
        .await
        .unwrap();

        let m = MIGRATOR.iter().find(|m| m.version == VERSION).unwrap();
        sqlx::raw_sql(&m.sql).execute(&pool).await.unwrap();

        type Row = (
            i64,
            String,
            Option<String>,
            Option<String>,
            Option<f64>,
            i64,
        );
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT id, state, client_hash, remove_hash, progress, client_adopted
               FROM book_requests ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            rows,
            [
                (1, "chosen".to_string(), None, None, None, 0),
                (2, "cancelled".to_string(), None, None, None, 0),
            ]
        );
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
