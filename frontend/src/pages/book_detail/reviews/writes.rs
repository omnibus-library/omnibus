//! Every write to your review, each explicit about its four fallbacks.
//!
//! - **Stars** ([`pick_stars`]): drawn at once, put back and flagged on
//!   [`ReviewsCtx::failure`] if refused, then the household is re-read, whose
//!   summary and order the change moved.
//! - **Text, notes and the spoiler flag** ([`save_text`]): one patch from the
//!   composer's Save, not optimistic, because the rendered Markdown comes from
//!   the server; the composer holds the draft until then.
//! - **Delete** ([`delete`]): confirmed first, applied on success only.
//!
//! No client cache holds reviews (web reads through server functions, mobile
//! calls REST directly), so the household re-read is the only follow-up. If it
//! fails, the old figures stay on screen with a note saying they are stale.

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

/// Your review as it reads once `patch` lands, for the fields the client can
/// draw itself: stars and the spoiler flag. `None` when nothing is left.
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
    if let Some(spoiler) = patch.spoiler {
        review.spoiler = spoiler;
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

/// Tap a star: rate the book `picked`, or clear only the stars when it is
/// already the rating. Text and notes are untouched either way.
pub(super) fn pick_stars(ctx: ReviewsCtx, uuid: String, server_url: String, picked: f32) {
    let current = mine_now(ctx).and_then(|r| r.stars);
    quick_write(
        ctx,
        (uuid, server_url),
        stars_patch(current, picked),
        QuickWrite::Stars,
    );
}

/// A write the client can draw before the server answers. The server's answer
/// replaces the drawn one; a refusal puts the previous review back.
fn quick_write(
    mut ctx: ReviewsCtx,
    (uuid, server_url): (String, String),
    patch: ReviewPatch,
    kind: QuickWrite,
) {
    let prev = mine_now(ctx);
    let my_op = bump(ctx.op_seq);
    ctx.failure.set(None);
    set_mine(
        ctx.reviews,
        apply_locally(prev.clone(), &patch, &uuid, now_unix()),
    );
    spawn(async move {
        let result = data::update_review(&server_url, &uuid, patch).await;
        // A newer write owns the card now; its answer carries this one's too.
        let latest = *ctx.op_seq.peek() == my_op;
        match result {
            Ok(mine) => {
                if latest {
                    set_mine(ctx.reviews, mine);
                }
                // Stars that landed moved the household, superseded or not.
                if kind == QuickWrite::Stars {
                    ctx.saved.note();
                    refresh_household(ctx, &uuid, &server_url).await;
                }
            }
            Err(_) if latest => {
                set_mine(ctx.reviews, prev);
                ctx.failure.set(Some(kind));
            }
            Err(_) => {}
        }
    });
}

/// Save the composer's text, notes and spoiler flag. The composer stays open
/// until this returns, and a refusal leaves its draft in place for another try.
pub(super) async fn save_text(
    ctx: ReviewsCtx,
    uuid: &str,
    server_url: &str,
    patch: ReviewPatch,
) -> Result<(), DataError> {
    let my_op = bump(ctx.op_seq);
    let mine = data::update_review(server_url, uuid, patch).await?;
    if *ctx.op_seq.peek() == my_op {
        set_mine(ctx.reviews, mine);
    }
    Ok(())
}

/// Delete your whole review. Applied only once the server confirms; stars
/// leaving the household re-read it like any stars change.
pub(super) async fn delete(
    mut ctx: ReviewsCtx,
    uuid: &str,
    server_url: &str,
) -> Result<(), DataError> {
    let my_op = bump(ctx.op_seq);
    let had_stars = mine_now(ctx).is_some_and(|r| r.stars.is_some());
    data::delete_review(server_url, uuid).await?;
    if *ctx.op_seq.peek() != my_op {
        return Ok(());
    }
    set_mine(ctx.reviews, None);
    ctx.failure.set(None);
    if had_stars {
        ctx.saved.note();
        refresh_household(ctx, uuid, server_url).await;
    }
    Ok(())
}

/// Re-read the summary and the other readers after a write moved them. Your
/// own review is taken from it only if no write started since.
async fn refresh_household(mut ctx: ReviewsCtx, uuid: &str, server_url: &str) {
    let my_refresh = bump(ctx.refresh_seq);
    let my_op = *ctx.op_seq.peek();
    ctx.refreshing.set(true);
    let result = data::get_book_reviews(server_url, uuid).await;
    if *ctx.refresh_seq.peek() != my_refresh {
        return;
    }
    ctx.refreshing.set(false);
    let Ok(fresh) = result else {
        ctx.refresh_failed.set(true);
        return;
    };
    ctx.refresh_failed.set(false);
    let keep_mine = *ctx.op_seq.peek() != my_op;
    let mut reviews = ctx.reviews.write();
    match reviews.as_mut() {
        Some(current) if keep_mine => {
            current.others = fresh.others;
            current.summary = fresh.summary;
        }
        _ => *reviews = Some(fresh),
    }
}
