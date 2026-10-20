//! Every write to your review, each explicit about its four fallbacks.
//!
//! - **Stars** ([`pick_stars`]): drawn at once, put back to the last review
//!   the server confirmed and flagged on [`ReviewsCtx::failure`] if refused,
//!   then the household is re-read, whose summary and order the change moved.
//! - **Text, notes and the spoiler flag** ([`save_text`]): one patch from the
//!   composer's Save, not optimistic, because the rendered Markdown comes from
//!   the server; the composer holds the draft until then.
//! - **Delete** ([`delete`]): confirmed first, applied on success only; its
//!   household re-read runs on its own, after the dialog has closed.
//!
//! The household re-read is the only follow-up here; `data::reviews` keeps
//! mobile's replica and outbox in step with each write. If it fails, the old
//! figures stay on screen with a note saying they are stale. A re-read that
//! overlapped one of your writes takes only the household, never your card,
//! since the write may be newer than what the server answered.

use dioxus::prelude::*;
use omnibus_shared::{BookReviews, Review, ReviewPatch};

use crate::data::{self, DataError};
use crate::time::now_unix;

use super::{QuickWrite, ReviewsCtx};

/// Advance `seq` without subscribing to it, returning the new value.
pub(super) fn bump(mut seq: Signal<u64>) -> u64 {
    let next = *seq.peek() + 1;
    seq.set(next);
    next
}

/// The patch a tap on `picked` sends: that value, or a clear of the stars
/// alone when it is already the rating.
pub(super) fn stars_patch(current: Option<f32>, picked: f32) -> ReviewPatch {
    let next = (current != Some(picked)).then_some(picked);
    ReviewPatch {
        stars: Some(next),
        ..Default::default()
    }
}

/// The patch the composer's Save sends: only the fields that changed since
/// it opened, so a stars change made elsewhere meanwhile survives. Blank text
/// clears its field.
pub(super) fn text_patch(
    seed_body: &str,
    seed_notes: &str,
    body: &str,
    notes: &str,
) -> ReviewPatch {
    ReviewPatch {
        body_md: field_change(seed_body, body),
        notes_md: field_change(seed_notes, notes),
        ..Default::default()
    }
}

fn field_change(seed: &str, now: &str) -> Option<Option<String>> {
    let blank = now.trim().is_empty();
    if seed == now || (blank && seed.trim().is_empty()) {
        return None;
    }
    Some((!blank).then(|| now.to_string()))
}

/// Your review as it reads once `patch` lands, for the one field the client
/// can draw itself: the stars. `None` when nothing is left.
pub(super) fn apply_locally(
    mine: Option<Review>,
    patch: &ReviewPatch,
    uuid: &str,
    now: i64,
) -> Option<Review> {
    let mut review = mine.unwrap_or_else(|| empty_review(uuid, now));
    if let Some(stars) = patch.stars {
        review.stars = stars;
        review.rated_at = stars.map(|_| now);
        review.updated_at = now;
    }
    let empty = review.stars.is_none() && review.body_md.is_none() && review.notes_md.is_none();
    (!empty).then_some(review)
}

fn empty_review(uuid: &str, now: i64) -> Review {
    Review {
        book_uuid: uuid.to_string(),
        stars: None,
        body_md: None,
        body_html: None,
        notes_md: None,
        notes_html: None,
        spoiler: false,
        rated_at: None,
        created_at: now,
        updated_at: now,
        rated_at_iso: None,
        created_at_iso: None,
        updated_at_iso: None,
    }
}

fn mine_now(ctx: ReviewsCtx) -> Option<Review> {
    ctx.reviews.peek().as_ref().and_then(|r| r.mine.clone())
}

fn set_mine(mut reviews: Signal<Option<BookReviews>>, mine: Option<Review>) {
    if let Some(r) = reviews.write().as_mut() {
        r.mine = mine;
    }
}

fn write_started(mut ctx: ReviewsCtx) {
    let n = *ctx.in_flight.peek();
    ctx.in_flight.set(n + 1);
}

fn write_finished(mut ctx: ReviewsCtx) {
    let n = *ctx.in_flight.peek();
    ctx.in_flight.set(n.saturating_sub(1));
}

/// Tap a star: rate the book `picked`, or clear only the stars when it is
/// already the rating. Text and notes are untouched either way.
pub(super) fn pick_stars(ctx: ReviewsCtx, uuid: String, server_url: String, picked: f32) {
    let current = mine_now(ctx).and_then(|r| r.stars);
    let patch = stars_patch(current, picked);
    let my_op = begin_stars_write(ctx, &patch, &uuid, now_unix());
    spawn(async move {
        let result = data::update_review(&server_url, &uuid, patch).await;
        if settle_stars_write(ctx, my_op, result) {
            refresh_household(ctx, &uuid, &server_url).await;
        }
    });
}

/// Draw a stars write at once and count it in flight; returns its op number.
pub(super) fn begin_stars_write(
    mut ctx: ReviewsCtx,
    patch: &ReviewPatch,
    uuid: &str,
    now: i64,
) -> u64 {
    let my_op = bump(ctx.op_seq);
    write_started(ctx);
    ctx.failure.set(None);
    set_mine(ctx.reviews, apply_locally(mine_now(ctx), patch, uuid, now));
    my_op
}

/// Take the server's answer to stars write `my_op`. A landing becomes the
/// confirmed review (and the card's, if no newer write owns it) and returns
/// true: the household needs a re-read, superseded or not. A refusal of the
/// latest write puts the card back to the confirmed review and says so.
pub(super) fn settle_stars_write(
    mut ctx: ReviewsCtx,
    my_op: u64,
    result: Result<Option<Review>, DataError>,
) -> bool {
    write_finished(ctx);
    let latest = *ctx.op_seq.peek() == my_op;
    match result {
        Ok(mine) => {
            ctx.confirmed.set(mine.clone());
            if latest {
                set_mine(ctx.reviews, mine);
            }
            ctx.saved.note();
            true
        }
        Err(_) => {
            if latest {
                let confirmed = ctx.confirmed.peek().clone();
                set_mine(ctx.reviews, confirmed);
                ctx.failure.set(Some(QuickWrite::Stars));
            }
            false
        }
    }
}

/// Save the composer's text, notes and spoiler flag. The composer stays open
/// until this returns, and a refusal leaves its draft in place for another try.
pub(super) async fn save_text(
    mut ctx: ReviewsCtx,
    uuid: &str,
    server_url: &str,
    patch: ReviewPatch,
) -> Result<(), DataError> {
    let my_op = bump(ctx.op_seq);
    write_started(ctx);
    let result = data::update_review(server_url, uuid, patch).await;
    write_finished(ctx);
    let mine = result?;
    ctx.confirmed.set(mine.clone());
    if *ctx.op_seq.peek() == my_op {
        set_mine(ctx.reviews, mine);
    }
    Ok(())
}

/// Delete your whole review. Applied only once the server confirms; stars
/// leaving the household re-read it like any stars change, on a task of its
/// own so the caller can close its dialog at once.
pub(super) async fn delete(
    mut ctx: ReviewsCtx,
    uuid: &str,
    server_url: &str,
) -> Result<(), DataError> {
    let my_op = bump(ctx.op_seq);
    let had_stars = mine_now(ctx).is_some_and(|r| r.stars.is_some());
    write_started(ctx);
    let result = data::delete_review(server_url, uuid).await;
    write_finished(ctx);
    result?;
    ctx.confirmed.set(None);
    if *ctx.op_seq.peek() != my_op {
        return Ok(());
    }
    set_mine(ctx.reviews, None);
    ctx.failure.set(None);
    if had_stars {
        ctx.saved.note();
        let (uuid, server_url) = (uuid.to_string(), server_url.to_string());
        spawn(async move { refresh_household(ctx, &uuid, &server_url).await });
    }
    Ok(())
}

/// Whether a household re-read may replace your card too: only if none of your
/// writes was in flight when it started and none started since, as either may
/// be newer than what the server answered.
pub(super) fn takes_fresh_mine(pending_at_start: u32, op_at_start: u64, op_now: u64) -> bool {
    pending_at_start == 0 && op_at_start == op_now
}

/// Re-read the summary and the other readers after a write moved them. Your
/// own review is taken from it only when [`takes_fresh_mine`] allows.
async fn refresh_household(mut ctx: ReviewsCtx, uuid: &str, server_url: &str) {
    let my_refresh = bump(ctx.refresh_seq);
    let op_at_start = *ctx.op_seq.peek();
    let pending_at_start = *ctx.in_flight.peek();
    ctx.refreshing.set(true);
    let result = data::refresh_book_reviews(server_url, uuid).await;
    if *ctx.refresh_seq.peek() != my_refresh {
        return;
    }
    ctx.refreshing.set(false);
    let Ok(fresh) = result else {
        ctx.refresh_failed.set(true);
        return;
    };
    ctx.refresh_failed.set(false);
    let take_mine = takes_fresh_mine(pending_at_start, op_at_start, *ctx.op_seq.peek());
    if take_mine {
        ctx.confirmed.set(fresh.mine.clone());
    }
    let mut reviews = ctx.reviews.write();
    match reviews.as_mut() {
        Some(current) if !take_mine => {
            current.others = fresh.others;
            current.summary = fresh.summary;
        }
        _ => *reviews = Some(fresh),
    }
}
