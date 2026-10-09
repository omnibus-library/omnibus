//! Mobile `delete_journal_entry` tests: an unsynced temp-id entry is cancelled locally, a synced one surfaces the server's refusal.

// The state-lock guard is deliberately held across awaits: it serializes
// whole async test bodies against process-global state, and each test owns
// its own thread + runtime, so there is no interleaving to deadlock on.
#![allow(clippy::await_holding_lock)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::http::StatusCode;
use axum::routing::delete;

use crate::offline::store;
use crate::offline::sync::test_state_lock;
use crate::offline::test_support::spawn_router;

use super::*;

#[tokio::test]
async fn delete_journal_entry_cancels_an_unsynced_entrys_queued_create_without_calling_the_server()
{
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    // Online, so a missing local short-circuit would reach the stub server
    // instead of being masked by a stale offline flag.
    crate::offline::sync::note_online();
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    let app = axum::Router::new().fallback(move || {
        let counter = counter.clone();
        async move {
            counter.fetch_add(1, Ordering::SeqCst);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    });
    let base_url = spawn_router(app).await;
    let unsynced = crate::offline::outbox::queue_create_journal(&CreateJournalEntry {
        client_id: None,
        book_uuid: "journals-book-1".into(),
        body_md: "Drafted offline".into(),
        progress: None,
        status: omnibus_shared::JournalStatus::Draft,
    })
    .await
    .expect("the create is queued");
    assert!(unsynced.id < 0, "an unsynced entry carries a temp id");
    let st = store::store().expect("store");
    let ops_before = st.ops_count().await;

    delete_journal_entry(&base_url, unsynced.id)
        .await
        .expect("an unsynced entry is cancelled locally");

    assert_eq!(
        st.ops_count().await,
        ops_before - 1,
        "the queued create must be cancelled, not a delete queued behind it"
    );
    assert_eq!(hits.load(Ordering::SeqCst), 0, "the server was contacted");
}

#[tokio::test]
async fn delete_journal_entry_surfaces_a_server_refusal_for_a_synced_entry() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    crate::offline::sync::note_online();
    let app = axum::Router::new().route(
        "/api/journals/42",
        delete(|| async { (StatusCode::FORBIDDEN, "not your entry") }),
    );
    let base_url = spawn_router(app).await;

    match delete_journal_entry(&base_url, 42).await {
        Err(DataError::Http { status, body }) => {
            assert_eq!(status, 403);
            assert_eq!(body, "not your entry");
        }
        other => panic!("a refused delete must not be queued or swallowed: {other:?}"),
    }
}
