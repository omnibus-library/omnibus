//! `finish_search` queueing the "needs a chooser" notification: once per arrival at choose,
//! only for a requester who may not pick a version, only for connections that are enabled
//! and subscribed, and with the book and requester as readers see them.

use omnibus_shared::NotificationEvent;
use serde_json::json;

use crate::notify::test_support::{deliveries, save_connection};
use crate::notify::NotifyError;
use crate::test_support::book_with_png_cover;

use super::*;

const EVENTS: &[NotificationEvent] = &[NotificationEvent::RequestNeedsChooser];
const URL: &str = "http://127.0.0.1:9";

/// Reader `ada`'s looking ebook request for "Dune" by Frank Herbert: its id and the book's uuid.
async fn looking_for_dune(pool: &SqlitePool) -> (i64, String) {
    let uuid = book_with_png_cover(pool, "Dune", "Frank Herbert", None).await;
    let ada = seed_user(pool, "ada").await;
    let id = start(pool, ada, &uuid, RequestKind::Ebook, MAX_LIVE)
        .await
        .unwrap()
        .request
        .id;
    (id, uuid)
}

/// Two versions on offer and one the ranking dropped.
fn found() -> SearchOutcome {
    SearchOutcome::Found(vec![
        ranked("best", 900.0, true, false),
        ranked("second", 800.0, false, false),
        ranked("dropped", 0.0, false, true),
    ])
}

async fn set_user(pool: &SqlitePool, set: &str) {
    sqlx::query(&format!("UPDATE users SET {set} WHERE username = 'ada'"))
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn finish_search_queues_one_notification_per_enabled_subscribed_connection() {
    let pool = pool().await;
    let phone = save_connection(&pool, "Phone", URL, true, EVENTS).await;
    let tablet = save_connection(&pool, "Tablet", URL, true, EVENTS).await;
    save_connection(&pool, "Off", URL, false, EVENTS).await;
    save_connection(&pool, "Unsubscribed", URL, true, &[]).await;
    let (id, uuid) = looking_for_dune(&pool).await;

    finish_search(&pool, id, found()).await.unwrap();

    let queued = deliveries(&pool).await;
    let connections: Vec<i64> = queued.iter().map(|d| d.connection_id).collect();
    assert_eq!(connections, [phone, tablet]);
    for row in &queued {
        assert_eq!(row.state, "queued");
        assert_eq!(row.event, "request_needs_chooser");
        assert_eq!(row.attempts, 0);
        assert_eq!(
            row.payload,
            json!({
                "request_id": id,
                "book_uuid": uuid,
                "title": "Dune",
                "author": "Frank Herbert",
                "kind": "ebook",
                "requester": "ada",
                "versions": 2,
            })
        );
    }
}

#[tokio::test]
async fn finish_search_names_the_requester_by_their_display_name() {
    let pool = pool().await;
    save_connection(&pool, "Phone", URL, true, EVENTS).await;
    let (id, _) = looking_for_dune(&pool).await;
    set_user(&pool, "display_name = 'Ada Lovelace'").await;

    finish_search(&pool, id, found()).await.unwrap();

    assert_eq!(
        deliveries(&pool).await[0].payload["requester"],
        "Ada Lovelace"
    );
}

#[tokio::test]
async fn finish_search_queues_an_untitled_book_when_the_book_is_gone() {
    let pool = pool().await;
    save_connection(&pool, "Phone", URL, true, EVENTS).await;
    let id = start_looking(&pool).await;

    finish_search(&pool, id, found()).await.unwrap();

    let payload = &deliveries(&pool).await[0].payload;
    assert_eq!(payload["title"], "Untitled");
    assert_eq!(payload["author"], serde_json::Value::Null);
}

#[tokio::test]
async fn finish_search_queues_nothing_for_an_admin_requester() {
    let pool = pool().await;
    save_connection(&pool, "Phone", URL, true, EVENTS).await;
    let (id, _) = looking_for_dune(&pool).await;
    set_user(&pool, "is_admin = 1").await;

    finish_search(&pool, id, found()).await.unwrap();

    assert_eq!(state_of(&pool, id).await.state, RequestState::Choose);
    assert!(deliveries(&pool).await.is_empty());
}

#[tokio::test]
async fn finish_search_queues_nothing_for_a_requester_who_may_choose_versions() {
    let pool = pool().await;
    save_connection(&pool, "Phone", URL, true, EVENTS).await;
    let (id, _) = looking_for_dune(&pool).await;
    set_user(&pool, "can_choose_request_versions = 1").await;

    finish_search(&pool, id, found()).await.unwrap();

    assert!(deliveries(&pool).await.is_empty());
}

#[tokio::test]
async fn finish_search_queues_nothing_when_the_search_ends_stuck() {
    let pool = pool().await;
    save_connection(&pool, "Phone", URL, true, EVENTS).await;
    let (id, _) = looking_for_dune(&pool).await;
    let stuck = SearchOutcome::Stuck {
        reason: StuckReason::NotFound,
        detail: None,
    };

    finish_search(&pool, id, stuck).await.unwrap();

    assert!(deliveries(&pool).await.is_empty());
}

#[tokio::test]
async fn finish_search_queues_nothing_for_a_request_no_longer_looking() {
    let pool = pool().await;
    save_connection(&pool, "Phone", URL, true, EVENTS).await;
    let (id, _) = looking_for_dune(&pool).await;
    set_state(&pool, id, "chosen").await;

    finish_search(&pool, id, found()).await.unwrap();

    assert!(deliveries(&pool).await.is_empty());
}

#[tokio::test]
async fn finish_search_queues_once_when_called_twice() {
    let pool = pool().await;
    save_connection(&pool, "Phone", URL, true, EVENTS).await;
    let (id, _) = looking_for_dune(&pool).await;

    finish_search(&pool, id, found()).await.unwrap();
    finish_search(&pool, id, found()).await.unwrap();

    assert_eq!(deliveries(&pool).await.len(), 1);
}

#[tokio::test]
async fn finish_search_leaves_the_request_looking_when_queueing_fails() {
    let pool = pool().await;
    let (id, _) = looking_for_dune(&pool).await;
    sqlx::query("DROP TABLE notification_deliveries")
        .execute(&pool)
        .await
        .unwrap();

    let result = finish_search(&pool, id, found()).await;

    assert!(matches!(
        result,
        Err(RequestError::Notify(NotifyError::Db(_)))
    ));
    assert_eq!(state_of(&pool, id).await.state, RequestState::Looking);
    assert!(versions(&pool, id).await.unwrap().is_empty());
}
