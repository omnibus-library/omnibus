use omnibus_shared::{RequestState, StuckReason};
use sqlx::SqlitePool;

use crate::requests::store::{self, RequestRow};
use crate::requests::test_support::{on_its_way, seed, tag, update, Call, StubClient};
use crate::worker::{Worker, WorkerConfig};

use super::*;

mod removal;

const NOW: i64 = 1_800_000_000;
const CATEGORY: &str = "omnibus";

async fn pool() -> SqlitePool {
    crate::pool::init_db("sqlite::memory:").await.unwrap()
}

async fn row(pool: &SqlitePool, id: i64) -> RequestRow {
    store::get(pool, id).await.unwrap().unwrap()
}

/// One tick at `now` with a fresh failure clock; returns whether work remains.
async fn tick(pool: &SqlitePool, client: &StubClient, now: i64) -> bool {
    poll_once(pool, client, CATEGORY, now, &mut None)
        .await
        .unwrap()
}

mod poll_once {
    use super::*;

    mod adding {
        use super::*;

        #[tokio::test]
        async fn hands_a_chosen_version_to_the_client_and_marks_it_on_its_way() {
            let pool = pool().await;
            let id = seed(&pool, "ada", "chosen").await;
            let client = StubClient::new();

            tick(&pool, &client, NOW).await;

            let after = row(&pool, id).await;
            let tag = after.client_tag.clone().unwrap();
            let added = Call::Add {
                link: "magnet:?xt=urn:btih:abc".to_string(),
                category: CATEGORY.to_string(),
                tag: tag.clone(),
            };
            assert_eq!(client.calls()[..2], [Call::Status(tag), added]);
            assert_eq!(after.state, RequestState::OnItsWay);
            assert_eq!(after.moved_at, Some(NOW));
        }

        #[tokio::test]
        async fn starts_a_download_with_no_finish_time_from_an_earlier_one() {
            let pool = pool().await;
            let id = seed(&pool, "ada", "chosen").await;
            update(&pool, id, &format!("expected_done_at = {}", NOW + 30)).await;
            let client = StubClient::new();

            tick(&pool, &client, NOW).await;

            let after = row(&pool, id).await;
            assert_eq!(after.state, RequestState::OnItsWay);
            assert_eq!(after.expected_done_at, None);
        }

        #[tokio::test]
        async fn adds_nothing_when_the_client_already_has_the_download() {
            let pool = pool().await;
            let id = seed(&pool, "ada", "chosen").await;
            // Handed over before a restart: the tag is stored, the client already shows it.
            update(&pool, id, &format!("client_tag = '{}'", tag(id))).await;
            let client = StubClient::new().with_status(&tag(id), 0.2, "downloading");

            tick(&pool, &client, NOW).await;

            assert!(!client.calls().iter().any(|c| matches!(c, Call::Add { .. })));
            assert_eq!(row(&pool, id).await.state, RequestState::OnItsWay);
        }
    }

    mod refused_link {
        use super::*;

        #[tokio::test]
        async fn stops_only_the_request_whose_link_is_refused_and_follows_the_others() {
            let pool = pool().await;
            let refused = seed(&pool, "ada", "chosen").await;
            update(&pool, refused, &format!("client_tag = '{}'", tag(refused))).await;
            let healthy = on_its_way(&pool, "grace", 0.2, NOW - 60).await;
            let client = StubClient::new().refusing(&tag(refused)).with_status(
                &tag(healthy),
                0.5,
                "downloading",
            );
            let mut failing_since = None;

            poll_once(&pool, &client, CATEGORY, NOW, &mut failing_since)
                .await
                .unwrap();

            let stopped = row(&pool, refused).await;
            assert_eq!(stopped.state, RequestState::Stuck);
            assert_eq!(stopped.stuck_reason, Some(StuckReason::StoppedMoving));
            assert_eq!(
                stopped.stuck_detail.as_deref(),
                Some("stub refused the link")
            );
            assert_eq!(row(&pool, healthy).await.progress, Some(0.5));
            assert_eq!(failing_since, None);
        }
    }

    mod tracking {
        use super::*;

        #[tokio::test]
        async fn asks_about_a_request_on_its_way_after_a_restart_and_never_adds_it_again() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW - 60).await;
            let client = StubClient::new().with_status(&tag(id), 0.4, "downloading");

            tick(&pool, &client, NOW).await;

            assert_eq!(client.calls(), [Call::Status(tag(id))]);
        }

        #[tokio::test]
        async fn records_rising_progress_and_restarts_the_stall_clock() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW - 60).await;
            let client = StubClient::new().with_status(&tag(id), 0.55, "downloading");

            tick(&pool, &client, NOW).await;

            let after = row(&pool, id).await;
            assert_eq!(after.progress, Some(0.55));
            assert_eq!(after.moved_at, Some(NOW));
        }

        #[tokio::test]
        async fn records_when_the_client_expects_the_download_to_finish() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW - 60).await;
            let client = StubClient::new()
                .with_status(&tag(id), 0.55, "downloading")
                .with_eta(&tag(id), 180);

            tick(&pool, &client, NOW).await;

            assert_eq!(row(&pool, id).await.expected_done_at, Some(NOW + 180));
        }

        #[tokio::test]
        async fn forgets_the_finish_time_once_the_client_cannot_tell() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW - 60).await;
            update(&pool, id, &format!("expected_done_at = {}", NOW + 30)).await;
            let client = StubClient::new()
                .with_status(&tag(id), 0.4, "stalledDL")
                .with_eta(&tag(id), 8_640_000);

            tick(&pool, &client, NOW).await;

            assert_eq!(row(&pool, id).await.expected_done_at, None);
        }

        #[tokio::test]
        async fn records_no_finish_time_once_the_download_is_complete() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.9, NOW - 60).await;
            update(&pool, id, &format!("expected_done_at = {}", NOW + 30)).await;
            // A seeding torrent's eta is how long it seeds, not how long it downloads.
            let client = StubClient::new()
                .with_status(&tag(id), 1.0, "uploading")
                .with_eta(&tag(id), 500);

            tick(&pool, &client, NOW).await;

            assert_eq!(row(&pool, id).await.expected_done_at, None);
        }

        #[tokio::test]
        async fn forgets_the_finish_time_of_a_download_it_stops() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW - STALL_SECS - 1).await;
            update(&pool, id, &format!("expected_done_at = {}", NOW + 30)).await;
            let client = StubClient::new().with_status(&tag(id), 0.4, "stalledDL");

            tick(&pool, &client, NOW).await;

            let after = row(&pool, id).await;
            assert_eq!(after.state, RequestState::Stuck);
            assert_eq!(after.expected_done_at, None);
        }

        #[tokio::test]
        async fn keeps_waiting_while_a_download_with_no_peers_is_inside_the_stall_window() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW - STALL_SECS).await;
            let client = StubClient::new().with_status(&tag(id), 0.4, "stalledDL");

            tick(&pool, &client, NOW).await;

            assert_eq!(row(&pool, id).await.state, RequestState::OnItsWay);
        }

        #[tokio::test]
        async fn stops_a_download_whose_bytes_have_not_moved_for_longer_than_the_stall_window() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW - STALL_SECS - 1).await;
            let client = StubClient::new().with_status(&tag(id), 0.4, "stalledDL");

            tick(&pool, &client, NOW).await;

            let after = row(&pool, id).await;
            assert_eq!(after.state, RequestState::Stuck);
            assert_eq!(after.stuck_reason, Some(StuckReason::StoppedMoving));
        }

        #[tokio::test]
        async fn stops_a_download_the_client_reports_as_failed() {
            let pool = pool().await;
            let broken = on_its_way(&pool, "ada", 0.4, NOW).await;
            let missing = on_its_way(&pool, "grace", 0.4, NOW).await;
            let client = StubClient::new()
                .with_status(&tag(broken), 0.5, "error")
                .with_status(&tag(missing), 0.5, "missingFiles");

            tick(&pool, &client, NOW).await;

            for id in [broken, missing] {
                assert_eq!(row(&pool, id).await.state, RequestState::Stuck, "{id}");
            }
        }
    }

    mod finishing {
        use super::*;

        #[tokio::test]
        async fn marks_a_finished_download_complete_and_leaves_it_on_its_way() {
            let pool = pool().await;
            let seeding = on_its_way(&pool, "ada", 0.9, NOW - 60).await;
            let paused = on_its_way(&pool, "grace", 0.9, NOW - 60).await;
            let client = StubClient::new()
                .with_status(&tag(seeding), 1.0, "stalledUP")
                .with_status(&tag(paused), 1.0, "pausedUP");

            let busy = tick(&pool, &client, NOW).await;

            for id in [seeding, paused] {
                let after = row(&pool, id).await;
                assert_eq!(after.state, RequestState::OnItsWay, "{id}");
                assert_eq!(after.progress, Some(1.0), "{id}");
            }
            assert!(!busy);
        }

        #[tokio::test]
        async fn stops_asking_about_a_download_once_it_is_complete() {
            let pool = pool().await;
            on_its_way(&pool, "ada", 1.0, NOW - 60).await;
            let client = StubClient::new();

            let busy = tick(&pool, &client, NOW).await;

            assert!(client.calls().is_empty());
            assert!(!busy);
        }

        #[tokio::test]
        async fn does_not_call_a_download_complete_while_the_client_is_still_checking_it() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.9, NOW - 60).await;
            let client = StubClient::new().with_status(&tag(id), 0.99, "checkingDL");

            tick(&pool, &client, NOW).await;

            assert_eq!(row(&pool, id).await.progress, Some(0.99));
        }
    }

    mod vanished_downloads {
        use super::*;

        #[tokio::test]
        async fn stops_a_download_the_client_no_longer_has_after_it_reported_progress() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW - 60).await;

            tick(&pool, &StubClient::new(), NOW).await;

            let after = row(&pool, id).await;
            assert_eq!(after.state, RequestState::Stuck);
            assert_eq!(after.stuck_reason, Some(StuckReason::StoppedMoving));
        }

        #[tokio::test]
        async fn waits_for_a_download_the_client_is_still_fetching_the_link_for() {
            let pool = pool().await;
            let id = seed(&pool, "ada", "on_its_way").await;
            update(
                &pool,
                id,
                &format!("client_tag = '{}', moved_at = {}", tag(id), NOW - 599),
            )
            .await;

            tick(&pool, &StubClient::new(), NOW).await;

            assert_eq!(row(&pool, id).await.state, RequestState::OnItsWay);
        }

        #[tokio::test]
        async fn stops_a_download_that_never_appears_in_the_client() {
            let pool = pool().await;
            let id = seed(&pool, "ada", "on_its_way").await;
            update(
                &pool,
                id,
                &format!("client_tag = '{}', moved_at = {}", tag(id), NOW - 601),
            )
            .await;

            tick(&pool, &StubClient::new(), NOW).await;

            assert_eq!(row(&pool, id).await.state, RequestState::Stuck);
        }
    }

    mod unreachable_client {
        use super::*;

        #[tokio::test]
        async fn changes_nothing_for_the_first_failed_tick_and_starts_the_failure_clock() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW - 60).await;
            let mut failing_since = None;

            poll_once(
                &pool,
                &StubClient::unreachable(),
                CATEGORY,
                NOW,
                &mut failing_since,
            )
            .await
            .unwrap();

            assert_eq!(row(&pool, id).await.state, RequestState::OnItsWay);
            assert_eq!(failing_since, Some(NOW));
        }

        #[tokio::test]
        async fn stops_every_download_on_its_way_after_ten_minutes_of_failing_and_keeps_picks_waiting(
        ) {
            let pool = pool().await;
            let tracked = on_its_way(&pool, "ada", 0.4, NOW).await;
            let waiting = seed(&pool, "grace", "chosen").await;
            let finished = on_its_way(&pool, "linus", 1.0, NOW).await;
            let mut failing_since = Some(NOW - 600);

            poll_once(
                &pool,
                &StubClient::unreachable(),
                CATEGORY,
                NOW,
                &mut failing_since,
            )
            .await
            .unwrap();

            let after = row(&pool, tracked).await;
            assert_eq!(after.state, RequestState::Stuck);
            assert_eq!(after.stuck_reason, Some(StuckReason::StoppedMoving));
            assert_eq!(row(&pool, waiting).await.state, RequestState::Chosen);
            assert_eq!(row(&pool, finished).await.state, RequestState::OnItsWay);
        }

        #[tokio::test]
        async fn waits_while_the_failure_is_shorter_than_ten_minutes() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW).await;
            let mut failing_since = Some(NOW - 599);

            poll_once(
                &pool,
                &StubClient::unreachable(),
                CATEGORY,
                NOW,
                &mut failing_since,
            )
            .await
            .unwrap();

            assert_eq!(row(&pool, id).await.state, RequestState::OnItsWay);
        }

        #[tokio::test]
        async fn forgets_the_failure_when_the_client_answers_again() {
            let pool = pool().await;
            let mut failing_since = Some(NOW - 300);

            poll_once(&pool, &StubClient::new(), CATEGORY, NOW, &mut failing_since)
                .await
                .unwrap();

            assert_eq!(failing_since, None);
        }
    }

    mod busy {
        use super::*;

        #[tokio::test]
        async fn reports_no_work_for_an_empty_table() {
            let pool = pool().await;

            assert!(!tick(&pool, &StubClient::new(), NOW).await);
        }

        #[tokio::test]
        async fn reports_work_while_a_download_is_incomplete() {
            let pool = pool().await;
            let id = on_its_way(&pool, "ada", 0.4, NOW).await;
            let client = StubClient::new().with_status(&tag(id), 0.5, "downloading");

            assert!(tick(&pool, &client, NOW).await);
        }
    }
}

mod database_failure {
    use super::*;

    #[tokio::test]
    async fn poll_once_propagates_a_db_error_when_the_pool_is_closed() {
        let pool = pool().await;
        pool.close().await;

        let result = poll_once(&pool, &StubClient::new(), CATEGORY, NOW, &mut None).await;

        assert!(matches!(result, Err(RequestError::Db(_))));
    }
}

mod no_client {
    use super::*;

    #[tokio::test]
    async fn poll_tick_stops_downloads_on_their_way_and_keeps_picks_waiting_without_a_client() {
        let pool = pool().await;
        let downloading = on_its_way(&pool, "ada", 0.4, NOW).await;
        let picked = seed(&pool, "grace", "chosen").await;

        let worker = Worker::new(pool.clone(), WorkerConfig::default());

        poll_tick(&pool, &worker, &mut None).await;

        let stopped = row(&pool, downloading).await;
        assert_eq!(stopped.state, RequestState::Stuck);
        assert_eq!(
            stopped.stuck_detail.as_deref(),
            Some("no download client configured")
        );
        assert_eq!(row(&pool, picked).await.state, RequestState::Chosen);
    }
}
