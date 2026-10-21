//! The section on mobile, driven in a live `VirtualDom` against a stub server:
//! a stars tap re-reads the household from the server rather than the replica
//! the tap just refreshed; the section re-reads it once when the replica moves,
//! never while a write to the review is queued or over a re-read already out
//! (reading once that one settles) or for a book no longer shown, keeps its
//! figures and note when that re-read fails, re-reads once after a first
//! read the replica moved under, and reloads a failed first read.

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

use crate::data::DataError;
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

/// Which of the household server's reads fail.
#[derive(Clone, Copy, PartialEq)]
enum Fails {
    Never,
    First,
    Later,
}

/// A server whose first read answers a 3.0 household, after `first_delay`,
/// and every later one a 4.5 household, but for the reads `fails` names,
/// counting them all as they arrive; a stars patch lands.
async fn household_server(fails: Fails, first_delay: Duration) -> (String, Arc<AtomicUsize>) {
    let reads = Arc::new(AtomicUsize::new(0));
    let counted = reads.clone();
    let path = format!("/api/reviews/{BOOK}");
    let app = Router::new().route(
        &path,
        get(move || {
            let counted = counted.clone();
            async move {
                let first = counted.fetch_add(1, Ordering::SeqCst) == 0;
                if first {
                    tokio::time::sleep(first_delay).await;
                }
                match (first, fails) {
                    (true, Fails::First) | (false, Fails::Later) => {
                        StatusCode::INTERNAL_SERVER_ERROR.into_response()
                    }
                    (true, _) => Json(household(3.0, 2)).into_response(),
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

/// Mount the section, its first read just sent.
fn mount_only(url: &str) -> (VirtualDom, ReviewsCtx) {
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
    (dom, ctx)
}

/// Mount the section and drive it until its first read has answered.
async fn mount(url: &str) -> (VirtualDom, ReviewsCtx) {
    let (mut dom, ctx) = mount_only(url);
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

/// The household's dimming, its stale note, and how many re-reads began.
fn household_flags(dom: &VirtualDom, ctx: ReviewsCtx) -> (bool, bool, u64) {
    dom.in_runtime(|| {
        (
            *ctx.refreshing.peek(),
            *ctx.refresh_failed.peek(),
            *ctx.refresh_seq.peek(),
        )
    })
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
    let (url, reads) = household_server(Fails::Never, Duration::ZERO).await;
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
    let (url, reads) = household_server(Fails::Never, Duration::ZERO).await;
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
    let (url, reads) = household_server(Fails::Never, Duration::ZERO).await;
    let (mut dom, ctx) = mount(&url).await;
    let (_, _, began) = household_flags(&dom, ctx);
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
    assert_eq!(
        household_flags(&dom, ctx),
        (false, false, began),
        "skipped before it began: never dimmed, never a failure"
    );
    fresh_start().await;
}

#[tokio::test]
async fn a_section_whose_first_read_failed_loads_again_when_the_replica_moves() {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    let (url, reads) = household_server(Fails::First, Duration::ZERO).await;
    let (mut dom, ctx) = mount(&url).await;
    assert_eq!(feed(&dom, ctx), FeedState::Failed);

    cache::notify_changed();
    run_until(&mut dom, |dom| average(dom, ctx) == Some(4.5)).await;

    assert_eq!(feed(&dom, ctx), FeedState::Loaded);
    assert_eq!(reads.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_background_re_read_never_replaces_one_already_out() {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    let (url, reads) = household_server(Fails::Never, Duration::ZERO).await;
    let (mut dom, ctx) = mount(&url).await;
    // A re-read a write started, not yet answered.
    let start = dom
        .in_runtime(|| writes::begin_refresh(ctx))
        .expect("begun");
    let (_, _, began) = household_flags(&dom, ctx);

    cache::notify_changed();
    settle(&mut dom).await;

    assert_eq!(reads.load(Ordering::SeqCst), 1, "no second re-read");
    assert_eq!(household_flags(&dom, ctx), (true, false, began));
    // The write's own re-read still lands, failure note and all.
    dom.in_runtime(|| writes::settle_refresh(ctx, start, Err(DataError::Offline)));
    assert_eq!(household_flags(&dom, ctx), (false, true, began));
}

/// A background re-read that fails, starting with the stale note `note`:
/// the figures and the note must come out as they went in.
async fn fail_a_background_re_read(note: bool) {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    let (url, reads) = household_server(Fails::Later, Duration::ZERO).await;
    let (mut dom, ctx) = mount(&url).await;
    dom.in_runtime(|| {
        let mut flag = ctx.refresh_failed;
        flag.set(note);
    });

    cache::notify_changed();
    let counted = reads.clone();
    run_until(&mut dom, |dom| {
        counted.load(Ordering::SeqCst) == 2 && !household_flags(dom, ctx).0
    })
    .await;
    settle(&mut dom).await;

    assert_eq!(average(&dom, ctx), Some(3.0), "the figures stay");
    let (refreshing, note_after, _) = household_flags(&dom, ctx);
    assert!(!refreshing, "no longer dimmed");
    assert_eq!(note_after, note, "the note stays as it was");
    assert_eq!(reads.load(Ordering::SeqCst), 2, "and it isn't retried");
}

#[tokio::test]
async fn a_background_re_read_that_fails_keeps_a_note_your_re_read_left() {
    fail_a_background_re_read(true).await;
}

#[tokio::test]
async fn a_background_re_read_that_fails_raises_no_note_of_its_own() {
    fail_a_background_re_read(false).await;
}

#[tokio::test]
async fn a_move_announced_while_a_re_read_is_out_is_read_once_that_settles() {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    let (url, reads) = household_server(Fails::Never, Duration::ZERO).await;
    let (mut dom, ctx) = mount(&url).await;
    // Out before the move: what it answers may predate it.
    let start = dom
        .in_runtime(|| writes::begin_refresh(ctx))
        .expect("begun");

    cache::notify_changed();
    settle(&mut dom).await;
    assert_eq!(
        reads.load(Ordering::SeqCst),
        1,
        "waits for the read that's out"
    );

    dom.in_runtime(|| writes::settle_refresh(ctx, start, Ok(household(3.0, 2))));
    run_until(&mut dom, |dom| average(dom, ctx) == Some(4.5)).await;
    settle(&mut dom).await;

    assert_eq!(reads.load(Ordering::SeqCst), 2, "exactly one read after it");
}

#[tokio::test]
async fn a_move_while_the_first_read_is_out_re_reads_the_household_once_it_lands() {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    let (url, reads) = household_server(Fails::Never, Duration::from_millis(300)).await;
    let (mut dom, ctx) = mount_only(&url);
    let counted = reads.clone();
    run_until(&mut dom, |_| counted.load(Ordering::SeqCst) == 1).await;
    assert_eq!(feed(&dom, ctx), FeedState::Pending, "the first read is out");

    // A drain lands a queued write meanwhile.
    cache::notify_changed();
    run_until(&mut dom, |dom| average(dom, ctx) == Some(4.5)).await;
    settle(&mut dom).await;

    assert_eq!(
        reads.load(Ordering::SeqCst),
        2,
        "one re-read once it landed"
    );
}

#[tokio::test]
async fn opening_a_book_the_replica_hasnt_moved_under_reads_it_once() {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    // As on any running app: the channel moved before this page mounted, and
    // the section's signal catches up only after it does.
    cache::notify_changed();
    let (url, reads) = household_server(Fails::Never, Duration::ZERO).await;
    let (mut dom, ctx) = mount(&url).await;
    settle(&mut dom).await;

    assert_eq!(average(&dom, ctx), Some(3.0));
    assert_eq!(reads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_background_re_read_asked_for_one_book_never_starts_for_the_next() {
    let _guard = test_state_lock().lock().unwrap();
    fresh_start().await;
    let (url, reads) = household_server(Fails::Never, Duration::ZERO).await;
    let (mut dom, ctx) = mount(&url).await;
    let (_, _, began) = household_flags(&dom, ctx);
    // Hold the store worker, so the re-read's outbox check waits behind it.
    store::store()
        .expect("store")
        .run_detached(|_| std::thread::sleep(Duration::from_millis(300)));

    dom.in_runtime(|| writes::refresh_after_sync(ctx, BOOK.into(), url.clone()));
    // Polled once: it is now parked on that check.
    dom.process_events();
    // Another book is shown while it waits.
    dom.in_runtime(|| {
        writes::bump(ctx.epoch);
    });
    settle(&mut dom).await;

    assert_eq!(reads.load(Ordering::SeqCst), 1);
    assert_eq!(household_flags(&dom, ctx), (false, false, began));
}
