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
//!
//! Each step is a sync `begin_*` / `settle_*` pair around one await, so the
//! bookkeeping is testable without a server. Tasks run on the scope owning
//! [`ReviewsCtx`], and every answer checks it is still for the book shown.

use std::future::Future;

use dioxus::core::Runtime;
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

/// Run `fut` on the scope owning `ctx`, not the component that started it:
/// a stop that remounts must not drop a write or a re-read half-way.
// `spawn` under `in_scope` files the task in the owner's own task list, which
// is what drops it with the owner; `Runtime::spawn` would only tag it, and
// leave it running against state the owner has already dropped.
fn spawn_owned(ctx: ReviewsCtx, fut: impl Future<Output = ()> + 'static) {
    Runtime::current().in_scope(ctx.owner, || {
        spawn(fut);
    });
}

/// Whether `ctx` still belongs to the book `epoch` was numbered for. Read
/// with `try_peek`: every signal in `ctx` lives and dies with the owner, so
/// one live check covers the rest even if a task outlives it.
fn still_showing(ctx: ReviewsCtx, epoch: u64) -> bool {
    ctx.epoch.try_peek().is_ok_and(|e| *e == epoch)
}

/// A write sent and not yet answered, counted in [`ReviewsCtx::in_flight`]
/// until it settles. Dropped unsettled, it still uncounts itself, so a torn
/// down task can't bar every later re-read from your card.
pub(super) struct WriteTicket {
    ctx: ReviewsCtx,
    op: u64,
    epoch: u64,
    open: bool,
}

impl WriteTicket {
    /// Uncount the write; true while its book is still the one shown.
    fn settle(mut self) -> bool {
        self.open = false;
        self.uncount()
    }

    // `try_*`: a drop can run while the state itself is being torn down.
    fn uncount(&self) -> bool {
        let mut ctx = self.ctx;
        let current = still_showing(ctx, self.epoch);
        if current {
            if let Ok(mut n) = ctx.in_flight.try_write() {
                *n = n.saturating_sub(1);
            }
        }
        current
    }
}

impl Drop for WriteTicket {
    fn drop(&mut self) {
        if self.open {
            self.uncount();
        }
    }
}

/// Number a new write, count it in flight and note the book it is for.
pub(super) fn begin_write(mut ctx: ReviewsCtx) -> WriteTicket {
    let op = bump(ctx.op_seq);
    let n = *ctx.in_flight.peek();
    ctx.in_flight.set(n + 1);
    WriteTicket {
        ctx,
        op,
        epoch: *ctx.epoch.peek(),
        open: true,
    }
}

/// Take `mine` as the server's word on your review, unless an answer to a
/// later op already did.
fn confirm(mut ctx: ReviewsCtx, op: u64, mine: Option<Review>) {
    if op >= *ctx.confirmed_op.peek() {
        ctx.confirmed_op.set(op);
        ctx.confirmed.set(mine);
    }
}

fn is_latest(ctx: ReviewsCtx, op: u64) -> bool {
    *ctx.op_seq.peek() == op
}

/// Tap a star: rate the book `picked`, or clear only the stars when it is
/// already the rating. Text and notes are untouched either way.
pub(super) fn pick_stars(ctx: ReviewsCtx, uuid: String, server_url: String, picked: f32) {
    let current = mine_now(ctx).and_then(|r| r.stars);
    let patch = stars_patch(current, picked);
    let ticket = begin_stars_write(ctx, &patch, &uuid, now_unix());
    spawn_owned(ctx, async move {
        let result = data::update_review(&server_url, &uuid, patch).await;
        if settle_stars_write(ctx, ticket, result) {
            refresh_household(ctx, &uuid, &server_url).await;
        }
    });
}

/// Draw a stars write at once and count it in flight.
pub(super) fn begin_stars_write(
    mut ctx: ReviewsCtx,
    patch: &ReviewPatch,
    uuid: &str,
    now: i64,
) -> WriteTicket {
    let ticket = begin_write(ctx);
    ctx.failure.set(None);
    set_mine(ctx.reviews, apply_locally(mine_now(ctx), patch, uuid, now));
    ticket
}

/// Take the server's answer to a stars write. A landing is confirmed (and
/// taken by the card, if no newer write owns it) and returns true: the
/// household needs a re-read, superseded or not. A refusal of the latest
/// write puts the card back to the confirmed review and says so.
pub(super) fn settle_stars_write(
    mut ctx: ReviewsCtx,
    ticket: WriteTicket,
    result: Result<Option<Review>, DataError>,
) -> bool {
    let op = ticket.op;
    if !ticket.settle() {
        return false;
    }
    let latest = is_latest(ctx, op);
    match result {
        Ok(mine) => {
            confirm(ctx, op, mine.clone());
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
    ctx: ReviewsCtx,
    uuid: &str,
    server_url: &str,
    patch: ReviewPatch,
) -> Result<(), DataError> {
    let ticket = begin_write(ctx);
    let result = data::update_review(server_url, uuid, patch).await;
    settle_save(ctx, ticket, result)
}

/// Take the server's answer to a Save: confirmed, and the card's if no newer
/// write owns it. A refusal changes nothing; the composer shows it.
pub(super) fn settle_save(
    ctx: ReviewsCtx,
    ticket: WriteTicket,
    result: Result<Option<Review>, DataError>,
) -> Result<(), DataError> {
    let op = ticket.op;
    let current = ticket.settle();
    let mine = result?;
    if current {
        confirm(ctx, op, mine.clone());
        if is_latest(ctx, op) {
            set_mine(ctx.reviews, mine);
        }
    }
    Ok(())
}

/// Delete your whole review. Applied only once the server confirms; stars
/// leaving the household re-read it like any stars change, on a task of its
/// own so the caller can close its dialog at once.
pub(super) async fn delete(ctx: ReviewsCtx, uuid: &str, server_url: &str) -> Result<(), DataError> {
    let had_stars = mine_now(ctx).is_some_and(|r| r.stars.is_some());
    let ticket = begin_write(ctx);
    let result = data::delete_review(server_url, uuid).await;
    if settle_delete(ctx, ticket, result)? && had_stars {
        ctx.saved.note();
        let (uuid, server_url) = (uuid.to_string(), server_url.to_string());
        spawn_owned(ctx, async move {
            refresh_household(ctx, &uuid, &server_url).await;
        });
    }
    Ok(())
}

/// Take the server's answer to a delete. Landed: nothing is confirmed any
/// more, and the card empties unless a newer write owns it; true when it did.
pub(super) fn settle_delete(
    mut ctx: ReviewsCtx,
    ticket: WriteTicket,
    result: Result<(), DataError>,
) -> Result<bool, DataError> {
    let op = ticket.op;
    let current = ticket.settle();
    result?;
    if !current {
        return Ok(false);
    }
    confirm(ctx, op, None);
    if !is_latest(ctx, op) {
        return Ok(false);
    }
    set_mine(ctx.reviews, None);
    ctx.failure.set(None);
    Ok(true)
}

/// Whether a household re-read may replace your card too: only if none of your
/// writes was in flight when it started and none started since, as either may
/// be newer than what the server answered.
pub(super) fn takes_fresh_mine(pending_at_start: u32, op_at_start: u64, op_now: u64) -> bool {
    pending_at_start == 0 && op_at_start == op_now
}

/// Where a household re-read started: its number, the book, the latest write
/// and how many writes were out.
pub(super) struct RefreshStart {
    refresh: u64,
    epoch: u64,
    op: u64,
    pending: u32,
}

/// Number a re-read and dim the household while it runs; `None` once the
/// state is gone.
pub(super) fn begin_refresh(mut ctx: ReviewsCtx) -> Option<RefreshStart> {
    let epoch = *ctx.epoch.try_peek().ok()?;
    let refresh = bump(ctx.refresh_seq);
    ctx.refreshing.set(true);
    Some(RefreshStart {
        refresh,
        epoch,
        op: *ctx.op_seq.peek(),
        pending: *ctx.in_flight.peek(),
    })
}

/// Take a re-read's answer, unless a newer re-read or another book replaced
/// it. The household always comes from it; your card only when
/// [`takes_fresh_mine`] allows. A failure keeps the figures and flags them.
pub(super) fn settle_refresh(
    mut ctx: ReviewsCtx,
    start: RefreshStart,
    result: Result<BookReviews, DataError>,
) {
    if !still_showing(ctx, start.epoch) || *ctx.refresh_seq.peek() != start.refresh {
        return;
    }
    ctx.refreshing.set(false);
    let Ok(fresh) = result else {
        ctx.refresh_failed.set(true);
        return;
    };
    ctx.refresh_failed.set(false);
    let take_mine = takes_fresh_mine(start.pending, start.op, *ctx.op_seq.peek());
    if take_mine {
        confirm(ctx, start.op, fresh.mine.clone());
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

/// Re-read the summary and the other readers after a write moved them, from
/// the server: `refresh_book_reviews`, not the cache-first `get_book_reviews`,
/// which on mobile answers with the replica the write just refreshed.
async fn refresh_household(ctx: ReviewsCtx, uuid: &str, server_url: &str) {
    let Some(start) = begin_refresh(ctx) else {
        return;
    };
    let result = data::refresh_book_reviews(server_url, uuid).await;
    settle_refresh(ctx, start, result);
}

/// Re-read the household when the replica moved under the section (a drain
/// or a revalidation landed), on the owner scope, and only while the book it
/// was asked for is still the one shown.
/// Skipped while the server can't answer for the book yet (offline, or one of
/// your writes to it queued): the drain that changes that moves the replica
/// again, which comes back here. Skipped too if a re-read began since the
/// section asked (it waits out one already running): that one asked the
/// server after the move, and replacing it would drop its result, and the
/// stale note with it if it fails.
pub(super) fn refresh_after_sync(ctx: ReviewsCtx, uuid: String, server_url: String) {
    let Ok(epoch) = ctx.epoch.try_peek().map(|e| *e) else {
        return;
    };
    spawn_owned(ctx, async move {
        if !data::can_refresh_book_reviews(&uuid).await || !still_showing(ctx, epoch) {
            return;
        }
        if ctx.refreshing.try_peek().is_ok_and(|busy| *busy) {
            return;
        }
        let Some(start) = begin_refresh(ctx) else {
            return;
        };
        let result = data::refresh_book_reviews(&server_url, &uuid).await;
        settle_resync(ctx, start, result);
    });
}

/// [`settle_refresh`] for a re-read you didn't ask for: a failure leaves the
/// figures, and any note about them, as they were.
fn settle_resync(mut ctx: ReviewsCtx, start: RefreshStart, result: Result<BookReviews, DataError>) {
    if result.is_ok() {
        settle_refresh(ctx, start, result);
    } else if still_showing(ctx, start.epoch) && *ctx.refresh_seq.peek() == start.refresh {
        ctx.refreshing.set(false);
    }
}
