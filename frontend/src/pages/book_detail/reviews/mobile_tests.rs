//! The section on mobile, driven in a live `VirtualDom` against a stub server:
//! a stars tap re-reads the household from the server rather than the replica
//! the tap just refreshed; the section re-reads it once when the replica moves,
//! never while a write to the review is queued, and reloads a failed first read.

// The state-lock guard is deliberately held across awaits: it serializes
// whole async test bodies against process-global state, and each test owns
// its own thread + runtime, so there is no interleaving to deadlock on.
#![allow(clippy::await_holding_lock)]

use std::cell::Cell;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use dioxus::dioxus_core::NoOpMutations;
use dioxus::prelude::*;
use omnibus_shared::{BookReviews, Review, ReviewBucket, ReviewPatch, ReviewSummary};

use crate::data::ServerUrl;
use crate::offline::sync::test_state_lock;
use crate::offline::test_support::spawn_router;
use crate::offline::{cache, outbox, store, sync};
use crate::pages::book_detail::FeedState;

use super::{use_book_reviews, writes, ReviewsCtx};

const BOOK: &str = "mobile-household-book";

thread_local! {
    /// The section state the harness mounted, for the test to act on.
    static MOUNTED: Cell<Option<ReviewsCtx>> = const { Cell::new(None) };
}

/// Mounts the section's state against `url`, as the mobile page does.
#[component]
fn Harness(url: String) -> Element {
    use_context_provider(|| ServerUrl(Signal::new(url.clone())));
    let ctx = use_book_reviews(BOOK.to_string());
    MOUNTED.with(|m| m.set(Some(ctx)));
    rsx! {}
}

fn household(average_stars: f32, ratings: i64) -> BookReviews {
    BookReviews {
        mine: None,
        others: Vec::new(),
        summary: Some(ReviewSummary {
            average_stars,
            ratings,
            buckets: (1..=10)
                .map(|half_stars| ReviewBucket {
                    half_stars,
                    readers: 0,
                })
                .collect(),
        }),
    }
}

/// A server whose first read answers a 3.0 household (or fails, with
/// `fail_first`) and every later one a 4.5 household, counting the reads; a
/// stars patch lands.
async fn household_server(fail_first: bool) -> (String, Arc<AtomicUsize>) {
    let reads = Arc::new(AtomicUsize::new(0));
    let counted = reads.clone();
    let path = format!("/api/reviews/{BOOK}");
    let app = Router::new().route(
        &path,
        get(move || {
            let counted = counted.clone();
            async move {
                let first = counted.fetch_add(1, Ordering::SeqCst) == 0;
                match (first, fail_first) {
                    (true, true) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                    (true, false) => Json(household(3.0, 2)).into_response(),
                    (false, _) => Json(household(4.5, 3)).into_response(),
                }
            }
        })
        .patch(|| async {
            Json(Some(Review {
                book_uuid: BOOK.into(),
                stars: Some(5.0),
                body_md: None,
                body_html: None,
                notes_md: None,
                notes_html: None,
                spoiler: false,
                rated_at: Some(9),
                created_at: 9,
                updated_at: 9,
                rated_at_iso: None,
                created_at_iso: None,
                updated_at_iso: None,
            }))
        }),
    );
    (spawn_router(app).await, reads)
}

/// Mount the section and drive it until its first read has answered.
async fn mount(url: &str) -> (VirtualDom, ReviewsCtx) {
    let mut dom = VirtualDom::new_with_props(
        Harness,
        HarnessProps {
            url: url.to_string(),
        },
    );
    dom.rebuild_in_place();
    let ctx = MOUNTED
        .with(Cell::get)
        .expect("the harness mounted the section");
    run_until(&mut dom, |dom| feed(dom, ctx) != FeedState::Pending).await;
    (dom, ctx)
}

/// Drive the dom a while longer, so a read that shouldn't happen would have.
async fn settle(dom: &mut VirtualDom) {
    for _ in 0..10 {
        let _ = tokio::time::timeout(Duration::from_millis(30), dom.wait_for_work()).await;
        dom.render_immediate(&mut NoOpMutations);
    }
}

fn feed(dom: &VirtualDom, ctx: ReviewsCtx) -> FeedState {
    dom.in_runtime(|| *ctx.feed.peek())
}

fn my_stars(dom: &VirtualDom, ctx: ReviewsCtx) -> Option<f32> {
    dom.in_runtime(|| {
        ctx.reviews
            .peek()
            .as_ref()
            .and_then(|r| r.mine.as_ref())
            .and_then(|m| m.stars)
    })
}

/// Drive the dom's tasks and effects until `done`, or fail after a while.
async fn run_until(dom: &mut VirtualDom, done: impl Fn(&VirtualDom) -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !done(dom) {
        assert!(
            tokio::time::Instant::now() < deadline,
            "the section never got there"
        );
        let _ = tokio::time::timeout(Duration::from_millis(50), dom.wait_for_work()).await;
        dom.render_immediate(&mut NoOpMutations);
    }
}

fn average(dom: &VirtualDom, ctx: ReviewsCtx) -> Option<f32> {
    dom.in_runtime(|| ctx.summary().map(|s| s.average_stars))
}

async fn fresh_start() {
    store::init_global_for_tests();
    let st = store::store().expect("test store");
    let ids: Vec<i64> = st.ops_list().await.into_iter().map(|o| o.id).collect();
    st.ops_delete_many(ids).await;
    st.kv_delete(&cache::keys::reviews(BOOK));
    sync::refresh_pending().await;
    sync::note_online();
}

#[tokio::test]
async fn a_stars_tap_re_reads_the_household_from_the_server_not_the_replica() {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    let (url, reads) = household_server(false).await;
    let (mut dom, ctx) = mount(&url).await;
    assert_eq!(average(&dom, ctx), Some(3.0));

    dom.in_runtime(|| writes::pick_stars(ctx, BOOK.into(), url.clone(), 5.0));
    run_until(&mut dom, |dom| average(dom, ctx) == Some(4.5)).await;
    settle(&mut dom).await;

    assert_eq!(
        reads.load(Ordering::SeqCst),
        2,
        "one re-read, from the server"
    );
}

#[tokio::test]
async fn the_section_re_reads_the_household_when_the_replica_moves_under_it() {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    let (url, reads) = household_server(false).await;
    let (mut dom, ctx) = mount(&url).await;
    let epoch = dom.in_runtime(|| *ctx.epoch.peek());

    cache::notify_changed();
    run_until(&mut dom, |dom| average(dom, ctx) == Some(4.5)).await;
    settle(&mut dom).await;

    assert_eq!(reads.load(Ordering::SeqCst), 2, "one re-read, no loop");
    assert_eq!(
        dom.in_runtime(|| *ctx.epoch.peek()),
        epoch,
        "the same book stays shown; nothing in flight is outdated"
    );
}

#[tokio::test]
async fn a_queued_write_for_the_book_keeps_a_resync_off_the_server_and_the_card() {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    let (url, reads) = household_server(false).await;
    let (mut dom, ctx) = mount(&url).await;
    let rerated = ReviewPatch {
        stars: Some(Some(1.0)),
        ..Default::default()
    };
    outbox::queue_update_review(BOOK, &rerated)
        .await
        .expect("queued");

    cache::notify_changed();
    settle(&mut dom).await;

    assert_eq!(
        reads.load(Ordering::SeqCst),
        1,
        "the server's answer would predate the queued write"
    );
    assert_eq!(my_stars(&dom, ctx), None, "the card is left alone");
    assert!(
        !dom.in_runtime(|| *ctx.refresh_failed.peek()),
        "a skipped re-read is not a failed one"
    );
    fresh_start().await;
}

#[tokio::test]
async fn a_section_whose_first_read_failed_loads_again_when_the_replica_moves() {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    let (url, reads) = household_server(true).await;
    let (mut dom, ctx) = mount(&url).await;
    assert_eq!(feed(&dom, ctx), FeedState::Failed);

    cache::notify_changed();
    run_until(&mut dom, |dom| average(dom, ctx) == Some(4.5)).await;

    assert_eq!(feed(&dom, ctx), FeedState::Loaded);
    assert_eq!(reads.load(Ordering::SeqCst), 2);
}
