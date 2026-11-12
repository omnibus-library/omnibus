//! The outbox drain against a local server: delivered, retried with backoff and not before
//! it is due, failed at the cap or at once, a turned-off connection, the claim that keeps
//! two passes from sending twice, a restart, and pruning; then `drain_tick`'s waits.

use std::time::Duration;

use omnibus_shared::NotificationEvent;

use crate::auth::now_unix;
use crate::test_support::{file_db_url, reopen_file_pool, EnvVarGuard};

use super::super::outbox::backoff;
use super::super::test_support::{deliveries, save_connection, Delivery};
use super::*;

const EVENTS: &[NotificationEvent] = &[NotificationEvent::RequestNeedsChooser];

/// Queue the sample event for connection `connection_id`, due now. Returns the row's id.
async fn queue_sample(pool: &SqlitePool, connection_id: i64) -> i64 {
    let event = Event::sample();
    sqlx::query_scalar(
        "INSERT INTO notification_deliveries (connection_id, event, payload, state)
         VALUES (?, ?, ?, 'queued') RETURNING id",
    )
    .bind(connection_id)
    .bind(event.name().as_str())
    .bind(event.payload().unwrap())
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Run one statement against the outbox.
async fn set(pool: &SqlitePool, sql: &str) {
    sqlx::query(sql).execute(pool).await.unwrap();
}

/// A connection to `server` with one sample notification queued for it.
async fn queued_for(pool: &SqlitePool, server: &MockServer) -> i64 {
    let id = save_connection(pool, "Phone", &server.uri(), true, EVENTS).await;
    queue_sample(pool, id).await;
    id
}

async fn only(pool: &SqlitePool) -> Delivery {
    let mut rows = deliveries(pool).await;
    assert_eq!(rows.len(), 1, "{rows:?}");
    rows.remove(0)
}

async fn sent(server: &MockServer) -> Vec<serde_json::Value> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| serde_json::from_slice(&r.body).unwrap())
        .collect()
}

mod drain_due {
    use super::*;

    #[tokio::test]
    async fn drain_due_delivers_a_due_notification_and_marks_it_delivered() {
        let pool = pool().await;
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        queued_for(&pool, &server).await;

        let drained = drain_due(&pool, &client()).await.unwrap();

        assert_eq!(drained.delivered, 1);
        let row = only(&pool).await;
        assert_eq!(row.state, "delivered");
        assert_eq!(row.attempts, 1);
        assert!(row.finished_at.is_some());
        assert_eq!(row.last_error, None);
        let bodies = sent(&server).await;
        assert_eq!(bodies.len(), 1);
        assert_eq!(bodies[0]["title"], "A request needs a version picked");
    }

    #[tokio::test]
    async fn drain_due_links_with_the_public_url_in_effect_when_it_sends() {
        let _env = EnvVarGuard::set("OMNIBUS_PUBLIC_URL", None);
        let pool = pool().await;
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        queued_for(&pool, &server).await;
        crate::set_public_url(&pool, Some("https://books.example.com/"))
            .await
            .unwrap();

        drain_due(&pool, &client()).await.unwrap();

        let click = sent(&server).await[0]["click"].clone();
        assert_eq!(
            click,
            "https://books.example.com/requests?book=00000000-0000-4000-8000-000000000000"
        );
    }

    #[tokio::test]
    async fn drain_due_retries_a_refusal_and_does_not_resend_it_before_it_is_due() {
        let pool = pool().await;
        let server = ntfy_answering(ResponseTemplate::new(500)).await;
        queued_for(&pool, &server).await;
        let before = now_unix();

        let first = drain_due(&pool, &client()).await.unwrap();
        let second = drain_due(&pool, &client()).await.unwrap();

        assert_eq!(first.retrying, 1);
        assert_eq!(second, Drained::default());
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
        let row = only(&pool).await;
        assert_eq!(row.state, "queued");
        assert_eq!(row.attempts, 1);
        assert!(row.last_error.as_deref().unwrap().contains("500"));
        assert!(row.next_attempt_at >= before + 30, "{row:?}");
        assert!(row.next_attempt_at <= now_unix() + 30, "{row:?}");
    }

    #[tokio::test]
    async fn drain_due_waits_out_a_retry_after_longer_than_its_backoff() {
        let pool = pool().await;
        let response = ResponseTemplate::new(429).insert_header("Retry-After", "600");
        let server = ntfy_answering(response).await;
        queued_for(&pool, &server).await;
        let before = now_unix();

        drain_due(&pool, &client()).await.unwrap();

        assert!(only(&pool).await.next_attempt_at >= before + 600);
    }

    #[tokio::test]
    async fn drain_due_fails_a_notification_whose_last_try_is_refused() {
        let pool = pool().await;
        let server = ntfy_answering(ResponseTemplate::new(503)).await;
        queued_for(&pool, &server).await;
        set(
            &pool,
            &format!(
                "UPDATE notification_deliveries SET attempts = {}",
                MAX_ATTEMPTS - 1
            ),
        )
        .await;

        let drained = drain_due(&pool, &client()).await.unwrap();

        assert_eq!(drained.failed, 1);
        let row = only(&pool).await;
        assert_eq!(row.state, "failed");
        assert_eq!(row.attempts, MAX_ATTEMPTS);
        assert!(row.finished_at.is_some());
        assert!(row.last_error.unwrap().contains("503"));
    }

    #[tokio::test]
    async fn drain_due_fails_a_refusal_retrying_cannot_change_at_once() {
        let pool = pool().await;
        let server = ntfy_answering(ResponseTemplate::new(401)).await;
        queued_for(&pool, &server).await;

        drain_due(&pool, &client()).await.unwrap();

        let row = only(&pool).await;
        assert_eq!(row.state, "failed");
        assert_eq!(row.attempts, 1);
        assert!(row.last_error.unwrap().contains("401"));
    }

    #[tokio::test]
    async fn drain_due_fails_without_sending_when_the_connection_was_turned_off() {
        let pool = pool().await;
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        queued_for(&pool, &server).await;
        set(&pool, "UPDATE notification_connections SET enabled = 0").await;

        drain_due(&pool, &client()).await.unwrap();

        let row = only(&pool).await;
        assert_eq!(row.state, "failed");
        assert_eq!(
            row.last_error.as_deref(),
            Some("not sent: the connection is turned off")
        );
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn drain_due_leaves_a_claimed_row_until_its_claim_runs_out() {
        let pool = pool().await;
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        queued_for(&pool, &server).await;
        // A pass that claimed the row and then died mid-send.
        set(&pool, "UPDATE notification_deliveries SET attempts = 1, next_attempt_at = strftime('%s', 'now') + 300").await;

        let held = drain_due(&pool, &client()).await.unwrap();
        set(
            &pool,
            "UPDATE notification_deliveries SET next_attempt_at = strftime('%s', 'now') - 1",
        )
        .await;
        let recovered = drain_due(&pool, &client()).await.unwrap();

        assert_eq!(held, Drained::default());
        assert_eq!(recovered.delivered, 1);
        assert_eq!(only(&pool).await.attempts, 2);
    }

    #[tokio::test]
    async fn drain_due_sends_a_notification_queued_before_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let url = file_db_url(dir.path());
        let pool = crate::pool::init_db(&url).await.unwrap();
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        queued_for(&pool, &server).await;

        let pool = reopen_file_pool(pool, &url).await;
        let drained = drain_due(&pool, &client()).await.unwrap();

        assert_eq!(drained.delivered, 1);
        assert_eq!(only(&pool).await.state, "delivered");
    }

    #[tokio::test]
    async fn drain_due_sends_a_row_once_when_two_passes_overlap() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::pool::init_db(&file_db_url(dir.path()))
            .await
            .unwrap();
        let slow = ResponseTemplate::new(200).set_delay(Duration::from_millis(300));
        let server = ntfy_answering(slow).await;
        queued_for(&pool, &server).await;
        let client = client();

        let (a, b) = tokio::join!(drain_due(&pool, &client), drain_due(&pool, &client));

        assert_eq!(a.unwrap().delivered + b.unwrap().delivered, 1);
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn drain_due_propagates_a_db_error_when_the_pool_is_closed() {
        let pool = pool().await;
        pool.close().await;

        let result = drain_due(&pool, &client()).await;

        assert!(matches!(result, Err(NotifyError::Db(_))));
    }
}

mod upkeep {
    use super::*;

    async fn finished(
        pool: &SqlitePool,
        connection_id: i64,
        state: &str,
        finished_at: Option<i64>,
    ) {
        let id = queue_sample(pool, connection_id).await;
        sqlx::query("UPDATE notification_deliveries SET state = ?, finished_at = ? WHERE id = ?")
            .bind(state)
            .bind(finished_at)
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn prune_finished_deletes_only_finished_rows_older_than_the_cutoff() {
        let pool = pool().await;
        let id = save_connection(&pool, "Phone", "http://127.0.0.1:9", true, EVENTS).await;
        finished(&pool, id, "delivered", Some(100)).await;
        finished(&pool, id, "failed", Some(100)).await;
        finished(&pool, id, "delivered", Some(5_000)).await;
        finished(&pool, id, "queued", None).await;

        let pruned = prune_finished(&pool, 1_000).await.unwrap();

        assert_eq!(pruned, 2);
        let left: Vec<String> = deliveries(&pool)
            .await
            .into_iter()
            .map(|d| d.state)
            .collect();
        assert_eq!(left, ["delivered", "queued"]);
    }

    #[tokio::test]
    async fn next_due_returns_the_earliest_queued_time_or_none() {
        let pool = pool().await;
        assert_eq!(next_due(&pool).await.unwrap(), None);
        let id = save_connection(&pool, "Phone", "http://127.0.0.1:9", true, EVENTS).await;
        for at in [500, 200] {
            let row = queue_sample(&pool, id).await;
            set(
                &pool,
                &format!(
                    "UPDATE notification_deliveries SET next_attempt_at = {at} WHERE id = {row}"
                ),
            )
            .await;
        }
        finished(&pool, id, "failed", Some(1)).await;
        set(
            &pool,
            "UPDATE notification_deliveries SET next_attempt_at = 1 WHERE state = 'failed'",
        )
        .await;

        assert_eq!(next_due(&pool).await.unwrap(), Some(200));
    }

    #[tokio::test]
    async fn drain_tick_waits_long_and_prunes_when_the_outbox_is_empty() {
        let pool = pool().await;
        let id = save_connection(&pool, "Phone", "http://127.0.0.1:9", true, EVENTS).await;
        finished(&pool, id, "delivered", Some(100)).await;
        let mut last_prune = None;

        let wait = drain_tick(&pool, &client(), &mut last_prune).await;

        assert_eq!(wait, Duration::from_secs(30));
        assert!(last_prune.is_some());
        assert!(deliveries(&pool).await.is_empty());
    }

    #[tokio::test]
    async fn drain_tick_waits_briefly_when_a_notification_falls_due_soon() {
        let pool = pool().await;
        let id = save_connection(&pool, "Phone", "http://127.0.0.1:9", true, EVENTS).await;
        let row = queue_sample(&pool, id).await;
        set(&pool, &format!("UPDATE notification_deliveries SET next_attempt_at = strftime('%s', 'now') + 2 WHERE id = {row}")).await;

        let wait = drain_tick(&pool, &client(), &mut None).await;

        assert_eq!(wait, Duration::from_secs(5));
    }

    #[tokio::test]
    async fn drain_tick_leaves_the_prune_until_an_hour_has_passed() {
        let pool = pool().await;
        let id = save_connection(&pool, "Phone", "http://127.0.0.1:9", true, EVENTS).await;
        finished(&pool, id, "delivered", Some(100)).await;
        let mut last_prune = Some(now_unix());

        drain_tick(&pool, &client(), &mut last_prune).await;

        assert_eq!(deliveries(&pool).await.len(), 1);
    }

    #[test]
    fn backoff_doubles_from_thirty_seconds_up_to_an_hour() {
        let waits: Vec<i64> = (1..=8).map(backoff).collect();

        assert_eq!(waits, [30, 60, 120, 240, 480, 960, 1920, 3600]);
        assert_eq!(backoff(0), 30);
        assert_eq!(backoff(1_000), 3600);
    }

    #[tokio::test]
    async fn kicked_resolves_after_a_kick() {
        kick();

        let woke = tokio::time::timeout(Duration::from_secs(1), kicked()).await;

        assert!(woke.is_ok());
    }

    #[tokio::test]
    async fn next_due_and_prune_finished_propagate_a_db_error_when_the_pool_is_closed() {
        let pool = pool().await;
        pool.close().await;

        assert!(matches!(next_due(&pool).await, Err(NotifyError::Db(_))));
        assert!(matches!(
            prune_finished(&pool, 1).await,
            Err(NotifyError::Db(_))
        ));
    }
}
