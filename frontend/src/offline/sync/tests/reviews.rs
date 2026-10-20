//! Replaying review writes: a merged patch reaches the server whole and its
//! answer settles the replica, a later queued write keeps the replica, a
//! failed one holds the book's later writes, a refused one re-reads, and a
//! retired rating op still replays. Each marks the stats figures stale.

#![allow(clippy::await_holding_lock)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::{patch, post};
use axum::{Json, Router};
use omnibus_shared::{BookReviews, RatingRecord, RatingUpdate, Review, ReviewPatch};

use super::super::*;
use crate::offline::cache;
use crate::offline::test_support::spawn_router;

use super::{clear_ops, enqueue_raw};

fn stars(value: f32) -> ReviewPatch {
    ReviewPatch {
        stars: Some(Some(value)),
        ..Default::default()
    }
}

fn rendered_review(uuid: &str) -> Review {
    Review {
        book_uuid: uuid.to_string(),
        stars: Some(4.0),
        body_md: Some("*Loved* it".into()),
        body_html: Some("<p><em>Loved</em> it</p>".into()),
        notes_md: None,
        notes_html: None,
        spoiler: false,
        rated_at: Some(900),
        created_at: 900,
        updated_at: 900,
        rated_at_iso: None,
        created_at_iso: None,
        updated_at_iso: None,
    }
}

fn no_reviews() -> BookReviews {
    BookReviews {
        mine: None,
        others: Vec::new(),
        summary: None,
    }
}

async fn fetched_at(key: &str) -> i64 {
    let st = store::store().expect("store");
    st.kv_get(key).await.expect("row kept").fetched_at
}

#[tokio::test]
async fn drain_replays_a_merged_review_patch_whole_and_keeps_the_servers_render() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let seen = Arc::new(Mutex::new(None::<serde_json::Value>));
    let record = seen.clone();
    let app = Router::new().route(
        "/api/reviews/{uuid}",
        patch(
            move |Path(uuid): Path<String>, Json(body): Json<serde_json::Value>| {
                let record = record.clone();
                async move {
                    *record.lock().unwrap() = Some(body);
                    Json(Some(rendered_review(&uuid)))
                }
            },
        ),
    );
    set_server_url(&spawn_router(app).await);
    let uuid = "replay-review-patch";
    let reviews_key = cache::keys::reviews(uuid);
    cache::put_json(&reviews_key, &no_reviews());
    cache::put_json(&cache::keys::stats("replay-review-patch-range"), &1);
    let stars = ReviewPatch {
        stars: Some(Some(4.0)),
        ..Default::default()
    };
    let text = ReviewPatch {
        body_md: Some(Some("*Loved* it".into())),
        ..Default::default()
    };
    outbox::queue_update_review(uuid, &stars).await.expect("q1");
    outbox::queue_update_review(uuid, &text).await.expect("q2");

    drain().await;

    let st = store::store().expect("store");
    assert_eq!(st.ops_count().await, 0);
    assert_eq!(
        seen.lock().unwrap().clone(),
        Some(serde_json::json!({ "stars": 4.0, "body_md": "*Loved* it" }))
    );
    let cached: BookReviews = cache::get_json(&reviews_key).await.expect("cached");
    assert_eq!(cached.mine, Some(rendered_review(uuid)));
    assert_eq!(
        fetched_at(&reviews_key).await,
        0,
        "the household is re-read"
    );
    assert_eq!(
        fetched_at(&cache::keys::stats("replay-review-patch-range")).await,
        0,
        "a stars change outdates the stats"
    );
    note_online();
}

#[tokio::test]
async fn drain_leaves_the_replica_to_a_write_still_queued_behind_the_replayed_one() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let app = Router::new().route(
        "/api/reviews/{uuid}",
        patch(|| async { StatusCode::INTERNAL_SERVER_ERROR })
            .delete(|| async { StatusCode::NO_CONTENT }),
    );
    set_server_url(&spawn_router(app).await);
    let uuid = "replay-review-behind";
    let reviews_key = cache::keys::reviews(uuid);
    cache::put_json(&reviews_key, &no_reviews());
    assert!(outbox::queue_delete_review(uuid).await);
    let rerated = ReviewPatch {
        stars: Some(Some(2.5)),
        ..Default::default()
    };
    outbox::queue_update_review(uuid, &rerated)
        .await
        .expect("queued behind the delete");

    drain().await;

    let st = store::store().expect("store");
    assert_eq!(st.ops_count().await, 1, "the refused patch stays queued");
    let cached: BookReviews = cache::get_json(&reviews_key).await.expect("cached");
    assert_eq!(
        cached.mine.and_then(|r| r.stars),
        Some(2.5),
        "the delete's answer must not undo the queued patch"
    );
    clear_ops().await;
    note_online();
}

#[tokio::test]
async fn drain_replays_a_retired_set_rating_and_marks_the_books_reviews_and_stats_stale() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let app = Router::new().route(
        "/api/ratings",
        post(|Json(update): Json<RatingUpdate>| async move {
            Json(RatingRecord {
                book_uuid: update.book_uuid,
                stars: update.stars,
                updated_at: 77,
            })
        }),
    );
    set_server_url(&spawn_router(app).await);
    let uuid = "replay-legacy-rating";
    let reviews_key = cache::keys::reviews(uuid);
    cache::put_json(&reviews_key, &no_reviews());
    cache::put_json(&cache::keys::stats("replay-legacy-range"), &1);
    enqueue_raw(&Op::SetRating {
        update: RatingUpdate {
            book_uuid: uuid.into(),
            stars: 3.5,
        },
    });

    drain().await;

    let st = store::store().expect("store");
    assert_eq!(st.ops_count().await, 0, "a queued rating still replays");
    assert_eq!(fetched_at(&reviews_key).await, 0);
    assert_eq!(
        fetched_at(&cache::keys::stats("replay-legacy-range")).await,
        0
    );
    note_online();
}

#[tokio::test]
async fn drain_holds_a_books_later_review_writes_behind_one_the_server_failed() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let patches = Arc::new(AtomicUsize::new(0));
    let counted = patches.clone();
    let app = Router::new()
        .route(
            "/api/reviews/{uuid}",
            patch(move |Path(uuid): Path<String>| {
                let counted = counted.clone();
                async move {
                    counted.fetch_add(1, Ordering::SeqCst);
                    Json(Some(rendered_review(&uuid)))
                }
            })
            .delete(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
        )
        .route(
            "/api/ratings",
            post(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
        );
    set_server_url(&spawn_router(app).await);
    let deleted = "drain-hold-deleted";
    let rated = "drain-hold-rated";
    let other = "drain-hold-other";
    assert!(outbox::queue_delete_review(deleted).await);
    outbox::queue_update_review(deleted, &stars(4.0))
        .await
        .expect("queued behind the delete");
    enqueue_raw(&Op::SetRating {
        update: RatingUpdate {
            book_uuid: rated.into(),
            stars: 2.0,
        },
    });
    outbox::queue_update_review(rated, &stars(4.5))
        .await
        .expect("queued behind the retired rating");
    outbox::queue_update_review(other, &stars(3.0))
        .await
        .expect("another book's write");

    drain().await;

    assert_eq!(
        patches.load(Ordering::SeqCst),
        1,
        "only the other book's patch may land"
    );
    let st = store::store().expect("store");
    let left: Vec<String> = st.ops_list().await.into_iter().map(|o| o.kind).collect();
    assert_eq!(
        left,
        vec!["DeleteReview", "UpdateReview", "SetRating", "UpdateReview"],
        "both books keep their writes, in order, for the next pass"
    );
    clear_ops().await;
    note_online();
}

#[tokio::test]
async fn drain_marks_the_books_reviews_stale_when_the_server_refuses_a_queued_patch() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let app = Router::new().route(
        "/api/reviews/{uuid}",
        patch(|| async { (StatusCode::BAD_REQUEST, "no") }),
    );
    set_server_url(&spawn_router(app).await);
    let uuid = "drain-refused-review";
    let reviews_key = cache::keys::reviews(uuid);
    cache::put_json(&reviews_key, &no_reviews());
    outbox::queue_update_review(uuid, &stars(1.0))
        .await
        .expect("queued");

    drain().await;

    let st = store::store().expect("store");
    assert_eq!(st.ops_count().await, 0, "a refused write is dropped");
    assert_eq!(
        fetched_at(&reviews_key).await,
        0,
        "the replica still draws the refused stars until it re-reads"
    );
    note_online();
}

#[tokio::test]
async fn a_drain_asked_for_during_a_pass_runs_another_pass() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;
    let app = Router::new().route(
        "/api/reviews/{uuid}",
        patch(|Path(uuid): Path<String>| async move {
            // A write queued mid-pass, and the drain it asks for.
            if uuid == "drain-again-first" {
                outbox::queue_update_review("drain-again-second", &stars(2.0))
                    .await
                    .expect("queued mid-pass");
                request_drain();
            }
            Json(Some(rendered_review(&uuid)))
        }),
    );
    set_server_url(&spawn_router(app).await);
    outbox::queue_update_review("drain-again-first", &stars(1.0))
        .await
        .expect("queued");
    // The pass below stands in for a running drain.
    DRAIN_ACTIVE.store(true, Ordering::SeqCst);
    DRAIN_AGAIN.store(true, Ordering::SeqCst);

    drain_while_asked().await;

    DRAIN_ACTIVE.store(false, Ordering::SeqCst);
    let st = store::store().expect("store");
    assert_eq!(
        st.ops_count().await,
        0,
        "the write queued mid-pass must not wait for the next sync tick"
    );
    note_online();
}
