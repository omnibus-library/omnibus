//! Taking downloads out of the client: the undo grace, the removal list, a job still being
//! fetched when it is swapped out, and an Undo racing the end of the grace.

use super::*;

/// The info hash of the second version `add_version` gives a request.
const SECOND_HASH: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/// A second version for request `id`, as the search would have found it; returns its id.
async fn add_version(pool: &SqlitePool, id: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO book_request_results (request_id, guid, title, download_url, score)
         VALUES (?, 'g2', 't2', ?, 0.5) RETURNING id",
    )
    .bind(id)
    .bind(format!("magnet:?xt=urn:btih:{SECOND_HASH}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn cancelled_with_download(pool: &SqlitePool, name: &str, cancel_at: i64) -> i64 {
    let id = on_its_way(pool, name, 0.4, NOW - 60).await;
    update(
        pool,
        id,
        &format!("prior_state = 'on_its_way', state = 'cancelled', cancel_at = {cancel_at}"),
    )
    .await;
    id
}

mod cancelled_downloads {
    use super::*;

    #[tokio::test]
    async fn waits_out_the_undo_grace_before_touching_the_download() {
        let pool = pool().await;
        let id = cancelled_with_download(&pool, "ada", NOW + 1).await;
        let client = StubClient::new().with_status(&hash(id), 0.4, "downloading");

        let busy = tick(&pool, &client, NOW).await;

        assert!(client.calls().is_empty());
        assert!(busy);
    }

    #[tokio::test]
    async fn removes_the_download_and_its_files_once_after_the_grace_and_then_forgets_it() {
        let pool = pool().await;
        let id = cancelled_with_download(&pool, "ada", NOW).await;
        let client = StubClient::new().with_status(&hash(id), 0.4, "downloading");

        tick(&pool, &client, NOW).await;
        tick(&pool, &client, NOW + 5).await;

        let remove = Call::Remove {
            hash: hash(id),
            delete_files: true,
        };
        let status = Call::Status(hash(id));
        assert_eq!(client.calls(), [status.clone(), remove, status]);
        let after = row(&pool, id).await;
        assert_eq!(after.state, RequestState::Cancelled);
        assert_eq!(
            (after.client_hash, after.remove_hash, after.cancel_at),
            (None, None, None)
        );
    }

    #[tokio::test]
    async fn only_clears_the_grace_of_a_cancelled_request_that_never_reached_the_client() {
        let pool = pool().await;
        let id = seed(&pool, "ada", "cancelled").await;
        update(&pool, id, &format!("cancel_at = {NOW}")).await;
        let client = StubClient::new();

        tick(&pool, &client, NOW).await;

        assert!(client.calls().is_empty());
        assert_eq!(row(&pool, id).await.cancel_at, None);
    }

    #[tokio::test]
    async fn removes_the_download_of_a_request_left_behind_by_a_purged_book() {
        let pool = pool().await;
        let id = on_its_way(&pool, "ada", 0.4, NOW - 60).await;
        update(
            &pool,
            id,
            &format!("state = 'cancelled', cancel_at = {NOW}"),
        )
        .await;
        let client = StubClient::new().with_status(&hash(id), 0.4, "downloading");

        tick(&pool, &client, NOW).await;

        let remove = Call::Remove {
            hash: hash(id),
            delete_files: true,
        };
        assert!(client.calls().contains(&remove));
    }
}

mod imported_downloads {
    use super::*;

    /// A request whose usenet job was imported: ready, with its job on the removal list.
    async fn imported_usenet_job(pool: &SqlitePool, name: &str) -> i64 {
        let id = on_its_way(pool, name, 1.0, NOW - 60).await;
        let chosen = row(pool, id).await.chosen_result_id;
        store::mark_ready(pool, id, chosen, true).await.unwrap();
        id
    }

    #[tokio::test]
    async fn removes_the_job_and_its_files_on_the_next_pass_and_then_forgets_it() {
        let pool = pool().await;
        let id = imported_usenet_job(&pool, "ada").await;
        let client = StubClient::new().with_status(&hash(id), 1.0, "stoppedUP");

        tick(&pool, &client, NOW).await;
        tick(&pool, &client, NOW + 5).await;

        let remove = Call::Remove {
            hash: hash(id),
            delete_files: true,
        };
        assert!(client.calls().contains(&remove));
        let after = row(&pool, id).await;
        assert_eq!(after.state, RequestState::Ready);
        assert_eq!(after.remove_hash, None);
    }

    #[tokio::test]
    async fn keeps_a_job_that_another_live_request_shares_and_drops_the_removal() {
        let pool = pool().await;
        let id = imported_usenet_job(&pool, "ada").await;
        let other = on_its_way(&pool, "bob", 0.4, NOW - 60).await;
        update(&pool, other, &format!("client_hash = '{}'", hash(id))).await;
        let client = StubClient::new().with_status(&hash(id), 1.0, "stoppedUP");

        tick(&pool, &client, NOW).await;

        assert!(!client
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Remove { .. })));
        assert_eq!(row(&pool, id).await.remove_hash, None);
    }
}

mod adopted_downloads {
    use super::*;

    #[tokio::test]
    async fn never_removes_a_torrent_the_client_already_held_when_the_request_is_cancelled() {
        let pool = pool().await;
        let id = on_its_way(&pool, "ada", 0.4, NOW - 60).await;
        update(&pool, id, "client_adopted = 1").await;
        store::cancel(&pool, id, 1, NOW).await.unwrap();
        let client = StubClient::new().with_status(&hash(id), 0.4, "downloading");

        tick(&pool, &client, NOW + 10).await;
        tick(&pool, &client, NOW + 20).await;

        assert!(!client
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Remove { .. })));
        assert!(client.status(&hash(id)).await.unwrap().is_some());
        let after = row(&pool, id).await;
        assert_eq!(after.state, RequestState::Cancelled);
        assert_eq!((after.client_hash, after.remove_hash), (None, None));
    }

    #[tokio::test]
    async fn never_removes_a_torrent_the_client_already_held_when_its_version_is_swapped() {
        let pool = pool().await;
        let id = on_its_way(&pool, "ada", 0.4, NOW - 60).await;
        update(&pool, id, "client_adopted = 1").await;
        let client = StubClient::new().with_status(&hash(id), 0.4, "downloading");

        store::swap(&pool, id, NOW, None).await.unwrap();
        tick(&pool, &client, NOW + 1).await;

        assert!(!client
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Remove { .. })));
        let after = row(&pool, id).await;
        assert_eq!((after.remove_hash, after.client_adopted), (None, false));
    }
}

mod undo_and_the_end_of_the_grace {
    use super::*;

    async fn cancel_and_undo_in_time(pool: &SqlitePool) -> i64 {
        let id = on_its_way(pool, "ada", 0.4, NOW - 60).await;
        store::cancel(pool, id, 1, NOW).await.unwrap();
        store::undo_cancel(pool, id, NOW + 9, 5).await.unwrap();
        id
    }

    #[tokio::test]
    async fn removes_nothing_when_the_undo_came_in_time_and_the_old_deadline_passes() {
        let pool = pool().await;
        let id = cancel_and_undo_in_time(&pool).await;
        let client = StubClient::new().with_status(&hash(id), 0.4, "downloading");

        tick(&pool, &client, NOW + 10).await;
        tick(&pool, &client, NOW + 60).await;

        assert!(!client
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Remove { .. })));
        assert_eq!(row(&pool, id).await.state, RequestState::OnItsWay);
    }

    #[tokio::test]
    async fn refuses_the_undo_once_the_poller_has_claimed_the_download() {
        let pool = pool().await;
        let id = on_its_way(&pool, "ada", 0.4, NOW - 60).await;
        store::cancel(&pool, id, 1, NOW).await.unwrap();
        let client = StubClient::new().with_status(&hash(id), 0.4, "downloading");

        tick(&pool, &client, NOW + 10).await;
        let late = store::undo_cancel(&pool, id, NOW + 9, 5).await;

        assert!(matches!(late, Err(store::RequestError::WrongState)));
        assert!(client
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Remove { .. })));
        assert_eq!(row(&pool, id).await.state, RequestState::Cancelled);
    }
}

mod swapped_downloads {
    use super::*;

    #[tokio::test]
    async fn removes_a_job_that_shows_up_after_a_swap_and_adds_the_new_pick_under_its_own_hash() {
        let pool = pool().await;
        let id = seed(&pool, "ada", "chosen").await;
        let second = add_version(&pool, id).await;
        let client = StubClient::new();
        tick(&pool, &client, NOW).await;
        store::swap(&pool, id, NOW + 1, Some("Swapped for another version"))
            .await
            .unwrap();
        store::choose(&pool, id, second).await.unwrap();

        tick(&pool, &client, NOW + 2).await;
        client.appears(&hash(id), 0.1, "downloading");
        tick(&pool, &client, NOW + 3).await;
        tick(&pool, &client, NOW + 4).await;

        let calls = client.calls();
        assert!(calls.contains(&Call::Remove {
            hash: hash(id),
            delete_files: true
        }));
        assert!(!calls.contains(&Call::Remove {
            hash: SECOND_HASH.to_string(),
            delete_files: true
        }));
        let after = row(&pool, id).await;
        assert_eq!(after.client_hash.as_deref(), Some(SECOND_HASH));
        assert_eq!(after.remove_hash, None);
    }

    #[tokio::test]
    async fn keeps_looking_for_a_job_that_has_not_shown_up_until_the_window_passes() {
        let pool = pool().await;
        let id = on_its_way(&pool, "ada", 0.4, NOW).await;
        store::swap(&pool, id, NOW, None).await.unwrap();
        let client = StubClient::new();

        tick(&pool, &client, NOW + 599).await;
        let kept = row(&pool, id).await.remove_hash;
        tick(&pool, &client, NOW + 601).await;

        assert_eq!(kept, Some(hash(id)));
        assert_eq!(row(&pool, id).await.remove_hash, None);
    }
}
