//! The book page's Reviews section: your review card (one-tap stars, the
//! Markdown composer for public text and private notes, the spoiler flag,
//! delete), the household summary, and the other readers' reviews. One
//! post-mount fetch of `BookReviews` feeds the section and the title area's
//! jump link through [`ReviewsCtx`], so SSR and the first paint both draw the
//! loader (rules 07, 12). Each write's optimistic update, revert and follow-up
//! read live in [`writes`]. Host-agnostic: the marquee stop and the mobile
//! layout each wrap [`BdReviewsSection`] in their own chrome.

use dioxus::core::current_scope_id;
use dioxus::prelude::*;
use omnibus_shared::{BookReviews, ReadStatus, Review, ReviewSummary};

use crate::components::loading::Stale;
use crate::components::{Loading, LoadingKind};
use crate::format::count_label;
use crate::{data, use_server_url};

use super::dates::use_local_dates_ready;
use super::journal::use_spoiler_reveal_binding;
use super::rule_facts::{use_rule_facts_saved, RuleFactsSaved};
use super::FeedState;

mod composer;
mod mine;
mod others;
mod stars;
mod summary;
mod writes;

#[cfg(test)]
mod tests;

pub(super) use summary::BdReviewsJumpLink;

/// Which of your quick writes last failed, so its own line can say so. The
/// spoiler flag rides the composer's Save, so stars are the only one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum QuickWrite {
    Stars,
}

/// The Reviews section's live state, shared by the section and the title
/// area's jump link: one fetch, one write sequence.
#[derive(Clone, Copy, PartialEq)]
pub(super) struct ReviewsCtx {
    /// The book's reviews; `None` until the first answer.
    reviews: Signal<Option<BookReviews>>,
    feed: Signal<FeedState>,
    /// The viewer's read status for the book is Finished, so spoilers open.
    finished: Signal<bool>,
    /// Bumped by every write; an answer applies only while it is the latest.
    op_seq: Signal<u64>,
    /// Writes sent and not yet answered, so a re-read that overlapped one
    /// leaves your card alone.
    in_flight: Signal<u32>,
    /// Your review as the server last confirmed it, which a refused write
    /// goes back to: the card may hold an earlier tap that never landed.
    confirmed: Signal<Option<Review>>,
    /// The op whose answer set `confirmed`, so an older answer arriving late
    /// can't move it backwards.
    confirmed_op: Signal<u64>,
    /// Bumped per book shown, so an answer for the last book never lands on
    /// this one.
    epoch: Signal<u64>,
    /// The scope that owns this state. Writes and re-reads run on it, so a
    /// stop remounting under them (the scroll-stops switch) can't drop one
    /// half-way.
    owner: ScopeId,
    /// Bumped by every household re-read, for the same guard.
    refresh_seq: Signal<u64>,
    /// The summary and the others are being re-read after a stars change.
    refreshing: Signal<bool>,
    /// That re-read failed, so they predate your last stars change.
    refresh_failed: Signal<bool>,
    /// The last stars write the server refused.
    failure: Signal<Option<QuickWrite>>,
    /// The page's smart-shelf counter; a stars change may move the book.
    saved: RuleFactsSaved,
}

impl ReviewsCtx {
    /// The household summary, once there is one. Reading it subscribes.
    pub(super) fn summary(&self) -> Option<ReviewSummary> {
        self.reviews.read().as_ref().and_then(|r| r.summary.clone())
    }
}

/// Declare the section's state and start its loads: the reviews on mount and
/// per book, the viewer's read status on mount and after every save the page
/// counts. A hook: call it unconditionally, once per page.
pub(super) fn use_book_reviews(uuid: String) -> ReviewsCtx {
    let server_url = use_server_url();
    let ctx = ReviewsCtx {
        reviews: use_signal(|| None),
        feed: use_signal(|| FeedState::Pending),
        finished: use_signal(|| false),
        op_seq: use_signal(|| 0),
        in_flight: use_signal(|| 0),
        confirmed: use_signal(|| None),
        confirmed_op: use_signal(|| 0),
        epoch: use_signal(|| 0),
        owner: current_scope_id(),
        refresh_seq: use_signal(|| 0),
        refreshing: use_signal(|| false),
        refresh_failed: use_signal(|| false),
        failure: use_signal(|| None),
        saved: use_rule_facts_saved(),
    };
    use_reviews_load(uuid.clone(), server_url.clone(), ctx);
    use_finished_load(uuid, server_url, ctx);
    ctx
}

/// Load the reviews for `uuid`. A new book starts the state over and outdates
/// every write still in flight for the last one.
fn use_reviews_load(uuid: String, server_url: String, ctx: ReviewsCtx) {
    let mut loaded_for = use_signal(String::new);
    use_effect(use_reactive!(|uuid| {
        if uuid.is_empty() {
            return;
        }
        let mut ctx = ctx;
        loaded_for.set(uuid.clone());
        writes::bump(ctx.epoch);
        let op = writes::bump(ctx.op_seq);
        writes::bump(ctx.refresh_seq);
        ctx.reviews.set(None);
        ctx.confirmed.set(None);
        ctx.confirmed_op.set(op);
        ctx.in_flight.set(0);
        ctx.feed.set(FeedState::Pending);
        ctx.refreshing.set(false);
        ctx.refresh_failed.set(false);
        ctx.failure.set(None);
        let url = server_url.clone();
        spawn(async move {
            let result = data::get_book_reviews(&url, &uuid).await;
            if *loaded_for.peek() != uuid {
                return;
            }
            let ok = result.is_ok();
            if let Ok(reviews) = result {
                ctx.confirmed.set(reviews.mine.clone());
                ctx.reviews.set(Some(reviews));
            }
            let next = ctx.feed.peek().after(ok);
            ctx.feed.set(next);
        });
    }));
}

/// Track whether the viewer has finished the book. Re-read after every save
/// the page counts, which is how a Finished picked on the Home stop opens the
/// spoilers here. Unknown reads as not finished: spoilers stay shut.
fn use_finished_load(uuid: String, server_url: String, ctx: ReviewsCtx) {
    let seq = use_signal(|| 0u64);
    let mut asked_for = use_signal(String::new);
    let saved = ctx.saved;
    use_effect(use_reactive!(|uuid| {
        let _ = saved.count();
        if uuid.is_empty() {
            return;
        }
        let mut finished = ctx.finished;
        if *asked_for.peek() != uuid {
            asked_for.set(uuid.clone());
            finished.set(false);
        }
        let mine = writes::bump(seq);
        let url = server_url.clone();
        spawn(async move {
            let status = data::get_read_status(&url, &uuid).await;
            if *seq.peek() != mine {
                return;
            }
            if let Ok(record) = status {
                finished.set(record.is_some_and(|r| r.status == ReadStatus::Finished));
            }
        });
    }));
}

/// The whole section: your card, the household summary, the other readers.
/// `overlay_composer` opens the composer over the host's stage (the marquee)
/// rather than in place of your card's text.
#[component]
pub(super) fn BdReviewsSection(
    uuid: String,
    ctx: ReviewsCtx,
    #[props(default = false)] overlay_composer: bool,
) -> Element {
    use_spoiler_reveal_binding();
    let dates_ready = use_local_dates_ready();
    let reviews = ctx.reviews.read().clone();
    let feed = (ctx.feed)();
    rsx! {
        div { id: "reviews", class: "bd-reviews", "data-testid": "reviews-section",
            match (reviews, feed) {
                (Some(r), _) => rsx! {
                    mine::BdMyReview { uuid: uuid.clone(), ctx, mine: r.mine.clone(), overlay_composer }
                    Stale { stale: (ctx.refreshing)(), class: "bd-review-household",
                        if let Some(summary) = r.summary.clone() {
                            summary::BdReviewSummary { summary }
                        }
                        others::BdOtherReviews {
                            others: r.others.clone(),
                            finished: (ctx.finished)(),
                            dates_ready,
                        }
                    }
                    if (ctx.refresh_failed)() {
                        p { class: "mono bd-review-stale-note", role: "status", "data-testid": "reviews-refresh-failed",
                            "Couldn\u{2019}t refresh the other readers\u{2019} ratings \u{2014} reopen the book to see them."
                        }
                    }
                },
                (None, FeedState::Failed) => rsx! {
                    div { class: "bd-journal-empty card", "data-testid": "reviews-error",
                        p { class: "mono", "The reviews didn\u{2019}t load \u{2014} try reopening the book." }
                    }
                },
                (None, _) => rsx! {
                    Loading {
                        kind: LoadingKind::Section,
                        class: "start",
                        testid: "reviews-loading",
                        label: "Gathering the reviews",
                    }
                },
            }
        }
    }
}

/// The section's counts line, in a `div.{class}`: the loading word while the
/// first read is out, the counts once it answered, a neutral dash if it
/// failed (the section says why), never a load that never ends (rule 12).
#[component]
pub(super) fn BdReviewsKicker(ctx: ReviewsCtx, #[props(into)] class: String) -> Element {
    let counts = ctx.reviews.read().as_ref().map(reviews_kicker);
    let feed = (ctx.feed)();
    rsx! {
        div { class: "{class}", "data-testid": "reviews-kicker",
            match (counts, feed) {
                (Some(counts), _) => rsx! { "{counts}" },
                (None, FeedState::Failed) => rsx! { span { aria_hidden: "true", "\u{2014}" } },
                (None, _) => rsx! { span { class: "ld-sheen", "Counting reviews" } },
            }
        }
    }
}

/// `2 reviews · 3 ratings`, counting yours: reviews are the ones with text,
/// ratings the ones with stars. Notes are private, so they count for neither.
pub(super) fn reviews_kicker(reviews: &BookReviews) -> String {
    let mine = reviews.mine.as_ref();
    let texts = reviews
        .others
        .iter()
        .filter(|r| r.body_md.is_some())
        .count()
        + usize::from(mine.is_some_and(|r| r.body_md.is_some()));
    let rated = reviews.others.iter().filter(|r| r.stars.is_some()).count()
        + usize::from(mine.is_some_and(|r| r.stars.is_some()));
    if texts + rated == 0 {
        return "No reviews yet".to_string();
    }
    let texts = i64::try_from(texts).unwrap_or(i64::MAX);
    let rated = i64::try_from(rated).unwrap_or(i64::MAX);
    format!(
        "{} \u{b7} {}",
        count_label(texts, "review"),
        count_label(rated, "rating")
    )
}
