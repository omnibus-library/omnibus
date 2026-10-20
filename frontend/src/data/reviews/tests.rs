//! Mobile review transport tests: a patch reaches the wire field by field, the
//! replica answers offline and while a write for the book is queued, a write
//! the server can't be reached for queues, and one that lands settles the
//! replica and outdates the stats.

// The state-lock guard is deliberately held across awaits: it serializes
// whole async test bodies against process-global state, and each test owns
// its own thread + runtime, so there is no interleaving to deadlock on.
#![allow(clippy::await_holding_lock)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::http::StatusCode;
use axum::routing::{delete, get, patch};
use axum::Json;

use crate::offline::sync::test_state_lock;
use crate::offline::test_support::spawn_router;
use crate::offline::{cache, outbox, store, sync};

use super::*;

/// A port nothing listens on: every request is a connectivity failure.
const UNREACHABLE: &str = "http://127.0.0.1:1";

fn review(uuid: &str, stars: Option<f32>) -> Review {
    Review {
        book_uuid: uuid.to_string(),
        stars,
        body_md: None,
        body_html: None,
        notes_md: Some("Mine alone".into()),
        notes_html: Some("<p>Mine alone</p>".into()),
        spoiler: false,
        rated_at: stars.map(|_| 5),
        created_at: 5,
        updated_at: 5,
        rated_at_iso: None,
        created_at_iso: None,
        updated_at_iso: None,
    }
}

fn reviews(mine: Option<Review>) -> BookReviews {
    BookReviews {
        mine,
        others: Vec::new(),
        summary: None,
    }
}

fn stars(value: f32) -> ReviewPatch {
    ReviewPatch {
        stars: Some(Some(value)),
        ..Default::default()
    }
}

/// A server that counts every request and refuses it.
async fn counting_server() -> (String, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    let app = axum::Router::new().fallback(move || {
        let counter = counter.clone();
        async move {
            counter.fetch_add(1, Ordering::SeqCst);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    });
    (spawn_router(app).await, hits)
}

async fn clear_ops() {
    let st = store::store().expect("test store");
    let ids: Vec<i64> = st.ops_list().await.into_iter().map(|o| o.id).collect();
    st.ops_delete_many(ids).await;
    sync::refresh_pending().await;
}

async fn fetched_at(key: &str) -> i64 {
    let st = store::store().expect("store");
    st.kv_get(key).await.expect("row kept").fetched_at
}

#[tokio::test]
async fn update_review_sends_a_cleared_field_as_null_and_reads_an_emptied_review_as_none() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    sync::note_online();
    let seen = Arc::new(Mutex::new(None::<serde_json::Value>));
    let record = seen.clone();
    let app = axum::Router::new().route(
        "/api/reviews/reviews-null-book",
        patch(move |Json(body): Json<serde_json::Value>| {
            let record = record.clone();
            async move {
                *record.lock().unwrap() = Some(body);
                Json(None::<Review>)
            }
        }),
    );
    let base_url = spawn_router(app).await;
    let clear_stars = ReviewPatch {
        stars: Some(None),
        ..Default::default()
    };

    let answer = update_review(&base_url, "reviews-null-book", clear_stars)
        .await
        .expect("an emptied review is not an error");

    assert_eq!(answer, None);
    // Text and notes were left out, so the server keeps them.
    assert_eq!(
        seen.lock().unwrap().clone(),
        Some(serde_json::json!({ "stars": null }))
    );
}

#[tokio::test]
async fn get_book_reviews_surfaces_a_missing_book_as_an_http_error() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    sync::note_online();
    let app = axum::Router::new().route(
        "/api/reviews/reviews-missing-book",
        get(|| async { (StatusCode::NOT_FOUND, "book not found") }),
    );
    let base_url = spawn_router(app).await;

    match get_book_reviews(&base_url, "reviews-missing-book").await {
        Err(DataError::Http { status, body }) => {
            assert_eq!(status, 404);
            assert_eq!(body, "book not found");
        }
        other => panic!("a missing book must stay an error: {other:?}"),
    }
}

#[tokio::test]
async fn get_book_reviews_draws_from_the_replica_while_offline() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let uuid = "reviews-offline-read";
    let cached = reviews(Some(review(uuid, Some(4.0))));
    cache::put_json(&cache::keys::reviews(uuid), &cached);
    sync::note_offline();

    let got = get_book_reviews(UNREACHABLE, uuid).await;

    sync::note_online();
    assert_eq!(got.expect("served from the replica"), cached);
}

#[tokio::test]
async fn update_review_queues_and_draws_on_the_replica_when_the_server_is_unreachable() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    sync::note_online();
    let uuid = "reviews-unreachable-write";
    cache::put_json(&cache::keys::reviews(uuid), &reviews(None));

    let mine = update_review(UNREACHABLE, uuid, stars(4.5))
        .await
        .expect("queued, not failed");

    assert_eq!(mine.and_then(|r| r.stars), Some(4.5));
    let cached: BookReviews = cache::get_json(&cache::keys::reviews(uuid))
        .await
        .expect("cached");
    assert_eq!(cached.mine.and_then(|r| r.stars), Some(4.5));
    assert!(outbox::review_queued(uuid).await);
    // Cleared first, so coming back online has nothing to drain.
    clear_ops().await;
    sync::note_online();
}

#[tokio::test]
async fn update_review_queues_behind_a_queued_write_for_the_book_without_reaching_the_server() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    sync::note_online();
    let uuid = "reviews-queue-behind";
    outbox::queue_update_review(uuid, &stars(3.0))
        .await
        .expect("an earlier write is queued");
    let (base_url, hits) = counting_server().await;
    let notes = ReviewPatch {
        notes_md: Some(Some("Later thought".into())),
        ..Default::default()
    };

    update_review(&base_url, uuid, notes)
        .await
        .expect("queued behind the earlier write");

    assert_eq!(hits.load(Ordering::SeqCst), 0, "it must not land first");
    let st = store::store().expect("store");
    let ops = st.ops_list().await;
    assert_eq!(ops.len(), 1, "merged into the queued patch");
    let op: outbox::Op = serde_json::from_str(&ops[0].payload).expect("op");
    assert!(
        matches!(&op, outbox::Op::UpdateReview { patch, .. }
            if patch.stars == Some(Some(3.0)) && patch.notes_md.is_some()),
        "got {op:?}"
    );
    clear_ops().await;
}

#[tokio::test]
async fn update_review_keeps_the_servers_answer_and_marks_the_stats_stale_after_a_stars_change() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    sync::note_online();
    let uuid = "reviews-landed";
    let answer = review(uuid, Some(2.0));
    let served = answer.clone();
    let app = axum::Router::new().route(
        "/api/reviews/reviews-landed",
        patch(move || {
            let served = served.clone();
            async move { Json(Some(served)) }
        }),
    );
    let base_url = spawn_router(app).await;
    let stats_key = cache::keys::stats("reviews-landed-range");
    cache::put_json(&cache::keys::reviews(uuid), &reviews(None));
    cache::put_json(&stats_key, &1);

    let mine = update_review(&base_url, uuid, stars(2.0))
        .await
        .expect("landed");

    assert_eq!(mine, Some(answer.clone()));
    let cached: BookReviews = cache::get_json(&cache::keys::reviews(uuid))
        .await
        .expect("cached");
    assert_eq!(cached.mine, Some(answer));
    assert_eq!(fetched_at(&stats_key).await, 0);
    assert!(!outbox::review_queued(uuid).await);
}

#[tokio::test]
async fn delete_review_queues_offline_and_drops_your_review_from_the_replica() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let uuid = "reviews-offline-delete";
    cache::put_json(
        &cache::keys::reviews(uuid),
        &reviews(Some(review(uuid, Some(5.0)))),
    );
    sync::note_offline();

    delete_review(UNREACHABLE, uuid)
        .await
        .expect("queued, not failed");

    let cached: BookReviews = cache::get_json(&cache::keys::reviews(uuid))
        .await
        .expect("cached");
    assert_eq!(cached.mine, None);
    assert!(outbox::review_queued(uuid).await);
    clear_ops().await;
    sync::note_online();
}

#[tokio::test]
async fn refresh_book_reviews_answers_offline_without_asking_while_a_write_for_the_book_is_queued()
{
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    sync::note_online();
    let uuid = "reviews-refresh-queued";
    cache::put_json(&cache::keys::reviews(uuid), &reviews(None));
    outbox::queue_update_review(uuid, &stars(1.5))
        .await
        .expect("queued");
    let (base_url, hits) = counting_server().await;

    let got = refresh_book_reviews(&base_url, uuid).await;

    // The server's household would predate the queued stars.
    assert!(matches!(got, Err(DataError::Offline)), "got {got:?}");
    assert_eq!(hits.load(Ordering::SeqCst), 0);
    clear_ops().await;
}

#[tokio::test]
async fn refresh_book_reviews_returns_and_keeps_the_servers_answer() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    sync::note_online();
    let uuid = "reviews-refresh-fresh";
    cache::put_json(&cache::keys::reviews(uuid), &reviews(None));
    let fresh = reviews(Some(review(uuid, Some(3.5))));
    let served = fresh.clone();
    let app = axum::Router::new().route(
        "/api/reviews/reviews-refresh-fresh",
        get(move || {
            let served = served.clone();
            async move { Json(served) }
        }),
    );
    let base_url = spawn_router(app).await;

    let got = refresh_book_reviews(&base_url, uuid)
        .await
        .expect("read from the server");

    assert_eq!(got, fresh);
    assert_eq!(
        cache::get_json::<BookReviews>(&cache::keys::reviews(uuid)).await,
        Some(fresh)
    );
}

#[tokio::test]
async fn update_review_refuses_a_patch_the_server_would_and_queues_nothing() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    sync::note_offline();
    let uuid = "reviews-invalid-patch";
    let oversized = ReviewPatch {
        body_md: Some(Some("x".repeat(omnibus_shared::REVIEW_TEXT_MAX_LEN + 1))),
        ..Default::default()
    };

    let got = update_review(UNREACHABLE, uuid, oversized).await;

    sync::note_online();
    assert!(matches!(got, Err(DataError::Other(_))), "got {got:?}");
    assert!(!outbox::review_queued(uuid).await);
}

#[tokio::test]
async fn delete_review_drops_your_review_from_the_replica_and_marks_the_stats_stale_once_it_lands()
{
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    sync::note_online();
    let uuid = "reviews-delete-landed";
    let app = axum::Router::new().route(
        "/api/reviews/reviews-delete-landed",
        delete(|| async { StatusCode::NO_CONTENT }),
    );
    let base_url = spawn_router(app).await;
    let stats_key = cache::keys::stats("reviews-delete-landed-range");
    cache::put_json(
        &cache::keys::reviews(uuid),
        &reviews(Some(review(uuid, Some(4.0)))),
    );
    cache::put_json(&stats_key, &1);

    delete_review(&base_url, uuid).await.expect("landed");

    let cached: BookReviews = cache::get_json(&cache::keys::reviews(uuid))
        .await
        .expect("cached");
    assert_eq!(cached.mine, None);
    assert_eq!(fetched_at(&stats_key).await, 0);
    assert!(!outbox::review_queued(uuid).await);
}

#[tokio::test]
async fn delete_review_queues_behind_a_queued_write_for_the_book_without_reaching_the_server() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    sync::note_online();
    let uuid = "reviews-delete-behind";
    outbox::queue_update_review(uuid, &stars(2.0))
        .await
        .expect("an earlier write is queued");
    let (base_url, hits) = counting_server().await;

    delete_review(&base_url, uuid)
        .await
        .expect("queued behind the earlier write");

    assert_eq!(hits.load(Ordering::SeqCst), 0, "it must not land first");
    let st = store::store().expect("store");
    let ops: Vec<outbox::Op> = st
        .ops_list()
        .await
        .iter()
        .map(|row| serde_json::from_str(&row.payload).expect("op"))
        .collect();
    assert_eq!(ops, vec![outbox::Op::DeleteReview { uuid: uuid.into() }]);
    clear_ops().await;
}

#[tokio::test]
async fn refresh_book_reviews_surfaces_a_failed_read_and_keeps_the_replica() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    sync::note_online();
    let uuid = "reviews-refresh-failed";
    let cached = reviews(Some(review(uuid, Some(4.0))));
    cache::put_json(&cache::keys::reviews(uuid), &cached);
    let (base_url, hits) = counting_server().await;

    let got = refresh_book_reviews(&base_url, uuid).await;

    assert!(
        matches!(got, Err(DataError::Http { status: 500, .. })),
        "a failed re-read must not pass for a fresh one: {got:?}"
    );
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    assert_eq!(
        cache::get_json::<BookReviews>(&cache::keys::reviews(uuid)).await,
        Some(cached)
    );
}
