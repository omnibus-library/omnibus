//! Replaying review writes: a merged patch reaches the server whole and its
//! answer settles the replica, a later queued write keeps the replica, and a
//! retired rating op still replays. Each marks the stats figures stale.

#![allow(clippy::await_holding_lock)]

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
