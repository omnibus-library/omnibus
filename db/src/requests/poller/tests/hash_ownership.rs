//! Who owns a torrent in the client: recorded before it is added, kept through a failed
//! answer or a cancel, and never taken from another request that downloads the same release.

use crate::requests::test_support::magnet;

use super::*;

/// Give request `id`'s only version the link `link`.
async fn relink(pool: &SqlitePool, id: i64, link: &str) {
    sqlx::query("UPDATE book_request_results SET download_url = ? WHERE request_id = ?")
        .bind(link)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

fn removed(client: &StubClient) -> Vec<String> {
    client
        .calls()
        .into_iter()
        .filter_map(|c| match c {
            Call::Remove { hash, .. } => Some(hash),
            _ => None,
        })
        .collect()
}

mod a_hand_off_the_client_answered_with_a_failure {
    use super::*;

    #[tokio::test]
    async fn is_still_owned_by_the_request_and_removed_when_it_is_cancelled() {
        let pool = pool().await;
        let id = seed(&pool, "ada", "chosen").await;
        let client = StubClient::new().adding_then_failing();

        tick(&pool, &client, NOW).await;
        tick(&pool, &client, NOW + 1).await;

        let after = row(&pool, id).await;
        assert_eq!(after.state, RequestState::OnItsWay);
        assert_eq!(after.client_hash, Some(hash(id)));
        assert!(!after.client_adopted);
        store::cancel(&pool, id, 1, NOW + 2).await.unwrap();
        tick(&pool, &client, NOW + 100).await;
        tick(&pool, &client, NOW + 101).await;
        assert_eq!(removed(&client), [hash(id)]);
    }
}

mod a_cancel_during_the_hand_off {
    use super::*;

    /// A request that has recorded the torrent it is adding, then is cancelled before the add
    /// answers: the late `mark_on_its_way` finds it cancelled.
    async fn cancelled_while_adding(pool: &SqlitePool, adopted: bool) -> i64 {
        let id = seed(pool, "ada", "chosen").await;
        assert!(store::claim_hash(pool, id, &hash(id)).await.unwrap());
        if adopted {
            update(pool, id, "client_adopted = 1").await;
        }
        store::cancel(pool, id, 1, NOW).await.unwrap();
        let late = store::mark_on_its_way(pool, id, &hash(id), adopted, NOW + 1).await;
        assert!(!late.unwrap());
        id
    }

    #[tokio::test]
    async fn queues_the_torrent_for_removal_and_waits_for_a_client_that_adds_it_late() {
        let pool = pool().await;
        let id = cancelled_while_adding(&pool, false).await;
        let client = StubClient::new();

        tick(&pool, &client, NOW + 100).await;
        let waiting = row(&pool, id).await;
        let removed_early = removed(&client);
        client.appears(&hash(id), 0.1, "downloading");
        tick(&pool, &client, NOW + 101).await;
        tick(&pool, &client, NOW + 102).await;

        assert_eq!(waiting.remove_hash, Some(hash(id)));
        assert!(removed_early.is_empty());
        assert_eq!(removed(&client), [hash(id)]);
        assert_eq!(row(&pool, id).await.remove_hash, None);
    }

    #[tokio::test]
    async fn removes_nothing_when_the_client_already_held_the_torrent() {
        let pool = pool().await;
        let id = cancelled_while_adding(&pool, true).await;
        let client = StubClient::new().with_status(&hash(id), 0.1, "downloading");

        tick(&pool, &client, NOW + 100).await;
        tick(&pool, &client, NOW + 101).await;

        assert!(removed(&client).is_empty());
        assert!(client.status(&hash(id)).await.unwrap().is_some());
    }
}

mod two_requests_for_one_release {
    use super::*;

    #[tokio::test]
    async fn the_owner_cancelling_leaves_the_torrent_to_the_request_that_adopted_it() {
        let pool = pool().await;
        let owner = seed(&pool, "ada", "chosen").await;
        let other = seed(&pool, "grace", "chosen").await;
        relink(&pool, other, &magnet(owner)).await;
        let client = StubClient::new();
        tick(&pool, &client, NOW).await;
        assert!(row(&pool, other).await.client_adopted);

        store::cancel(&pool, owner, 1, NOW + 1).await.unwrap();
        tick(&pool, &client, NOW + 100).await;
        tick(&pool, &client, NOW + 101).await;

        assert!(removed(&client).is_empty());
        assert_eq!(row(&pool, other).await.state, RequestState::OnItsWay);
        assert!(client.status(&hash(owner)).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn a_swap_to_another_version_of_the_same_release_keeps_its_download() {
        let pool = pool().await;
        let id = seed(&pool, "ada", "chosen").await;
        let second: i64 = sqlx::query_scalar(
            "INSERT INTO book_request_results (request_id, guid, title, download_url, score)
             VALUES (?, 'g2', 't2', ?, 0.5) RETURNING id",
        )
        .bind(id)
        .bind(magnet(id))
        .fetch_one(&pool)
        .await
        .unwrap();
        let client = StubClient::new();
        tick(&pool, &client, NOW).await;
        store::swap(&pool, id, NOW + 1, None).await.unwrap();
        store::choose(&pool, id, second).await.unwrap();

        for later in [2, 3, 4] {
            tick(&pool, &client, NOW + later).await;
        }

        assert!(removed(&client).is_empty());
        let after = row(&pool, id).await;
        assert_eq!(after.state, RequestState::OnItsWay);
        assert_eq!(after.client_hash, Some(hash(id)));
        assert!(!after.client_adopted);
        assert_eq!(after.remove_hash, None);
        assert!(client.status(&hash(id)).await.unwrap().is_some());
    }
}
