//! `enqueue_request_needs_chooser` called again for a request whose first notification is
//! still waiting: the earlier one is replaced, and another request's is left alone.

use omnibus_shared::NotificationEvent;

use super::super::test_support::{deliveries, request_in_choose, save_connection};
use super::*;

const EVENTS: &[NotificationEvent] = &[NotificationEvent::RequestNeedsChooser];
const URL: &str = "http://127.0.0.1:9";

async fn enqueue(pool: &SqlitePool, request_id: i64) -> u64 {
    let mut conn = pool.acquire().await.unwrap();
    enqueue_request_needs_chooser(&mut conn, request_id, None).await
}

/// Two versions on offer for request `request_id`.
async fn offer_two_versions(pool: &SqlitePool, request_id: i64) {
    for guid in ["a", "b"] {
        sqlx::query(
            "INSERT INTO book_request_results (request_id, guid, title, download_url, score)
             VALUES (?, ?, 't', 'magnet:?xt=urn:btih:x', 1.0)",
        )
        .bind(request_id)
        .bind(guid)
        .execute(pool)
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn enqueue_request_needs_chooser_replaces_what_still_waits_for_the_same_request() {
    let pool = pool().await;
    save_connection(&pool, "Phone", URL, true, EVENTS).await;
    save_connection(&pool, "Tablet", URL, true, EVENTS).await;
    let ada = request_in_choose(&pool, "ada").await;
    let grace = request_in_choose(&pool, "grace").await;
    enqueue(&pool, ada).await;
    enqueue(&pool, grace).await;
    // Ada's first notifications are waiting out a backoff.
    sqlx::query(
        "UPDATE notification_deliveries SET attempts = 1, next_attempt_at = next_attempt_at + 600
          WHERE json_extract(payload, '$.request_id') = ?",
    )
    .bind(ada)
    .execute(&pool)
    .await
    .unwrap();
    let grace_before: Vec<_> = deliveries(&pool)
        .await
        .into_iter()
        .filter(|d| d.payload["request_id"] == grace)
        .collect();
    offer_two_versions(&pool, ada).await;

    let queued = enqueue(&pool, ada).await;

    assert_eq!(queued, 2);
    let rows = deliveries(&pool).await;
    let ada_rows: Vec<_> = rows
        .iter()
        .filter(|d| d.payload["request_id"] == ada)
        .collect();
    assert_eq!(ada_rows.len(), 2);
    let mut ada_connections: Vec<i64> = ada_rows.iter().map(|d| d.connection_id).collect();
    ada_connections.sort_unstable();
    ada_connections.dedup();
    assert_eq!(ada_connections.len(), 2);
    for row in &ada_rows {
        assert_eq!(row.payload["versions"], 2);
        assert_eq!(row.attempts, 0);
    }
    let grace_after: Vec<_> = rows
        .into_iter()
        .filter(|d| d.payload["request_id"] == grace)
        .collect();
    assert_eq!(grace_after, grace_before);
}

#[tokio::test]
async fn enqueue_request_needs_chooser_keeps_a_finished_notification_of_the_request() {
    let pool = pool().await;
    save_connection(&pool, "Phone", URL, true, EVENTS).await;
    let ada = request_in_choose(&pool, "ada").await;
    enqueue(&pool, ada).await;
    sqlx::query("UPDATE notification_deliveries SET state = 'delivered', finished_at = 100")
        .execute(&pool)
        .await
        .unwrap();

    enqueue(&pool, ada).await;

    let states: Vec<String> = deliveries(&pool)
        .await
        .into_iter()
        .map(|d| d.state)
        .collect();
    assert_eq!(states, ["delivered", "queued"]);
}
