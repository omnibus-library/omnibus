//! The other readers: every review with text as a card (avatar, name, stars,
//! date, the text clipped behind Read more), then every rating without text
//! gathered into one compact row of avatars and stars. A review flagged as a
//! spoiler keeps its stars in view but its text behind a reveal, unless the
//! viewer has finished the book.

use dioxus::prelude::*;
use omnibus_shared::AttributedReview;

use crate::components::user_avatar::UserAvatar;
use crate::components::{fmt_stars, StarRating};
use crate::pages::book_detail::dates::{fmt_long_date, local_date_offset};

use super::mine::rendered;

/// Text past this many characters, or lines, opens clipped behind Read more.
const CLAMP_CHARS: usize = 420;
const CLAMP_LINES: usize = 6;

/// The other readers' reviews, in the server's order.
#[component]
pub(super) fn BdOtherReviews(
    others: Vec<AttributedReview>,
    finished: bool,
    dates_ready: ReadSignal<bool>,
) -> Element {
    let (texts, ratings) = split_others(others);
    rsx! {
        if texts.is_empty() && ratings.is_empty() {
            p { class: "mono bd-review-quiet", "data-testid": "other-reviews-empty",
                "No one else has rated or reviewed this book yet."
            }
        }
        if !texts.is_empty() {
            div { class: "bd-review-list", "data-testid": "other-reviews",
                for review in texts {
                    BdOtherReviewCard { key: "{review.user_id}", review, finished, dates_ready }
                }
            }
        }
        if !ratings.is_empty() {
            BdStarsOnlyRow { ratings }
        }
    }
}

/// Reviews with text, then ratings without, each keeping the server's order.
pub(super) fn split_others(
    others: Vec<AttributedReview>,
) -> (Vec<AttributedReview>, Vec<AttributedReview>) {
    others.into_iter().partition(|r| r.body_md.is_some())
}

/// Whether a review's text stays behind its spoiler reveal.
pub(super) fn spoiler_veiled(spoiler: bool, viewer_finished: bool, revealed: bool) -> bool {
    spoiler && !viewer_finished && !revealed
}

/// Whether a review's text is long enough to open clipped.
pub(super) fn needs_read_more(md: &str) -> bool {
    md.trim().chars().take(CLAMP_CHARS + 1).count() > CLAMP_CHARS
        || md.trim().lines().take(CLAMP_LINES + 1).count() > CLAMP_LINES
}

/// One reader's review with text.
#[component]
fn BdOtherReviewCard(
    review: AttributedReview,
    finished: bool,
    dates_ready: ReadSignal<bool>,
) -> Element {
    let mut revealed = use_signal(|| false);
    let mut expanded = use_signal(|| false);
    let veiled = spoiler_veiled(review.spoiler, finished, revealed());
    let md = review.body_md.clone().unwrap_or_default();
    let html = rendered(review.body_md.as_deref(), review.body_html.as_deref()).unwrap_or_default();
    let clipped = needs_read_more(&md) && !expanded();
    let date = fmt_long_date(
        review.updated_at,
        local_date_offset(dates_ready(), review.updated_at),
    );
    rsx! {
        article { class: "bd-review-card", "data-testid": "review-card",
            div { class: "bd-review-card-head",
                UserAvatar {
                    user_id: review.user_id,
                    name: review.username.clone(),
                    has_avatar: review.has_avatar,
                    class: "bd-review-avatar",
                }
                div { class: "bd-review-byline",
                    span { class: "bd-review-name", "{review.username}" }
                    if let Some(stars) = review.stars {
                        StarRating { stars, extra_class: "bd-review-card-stars".to_string() }
                    }
                    span { class: "mono bd-review-date", "{date}" }
                    if review.spoiler {
                        span { class: "mono bd-review-spoilertag", "spoilers" }
                    }
                }
            }
            if veiled {
                div { class: "bd-review-veil", "data-testid": "review-spoiler-veil",
                    span { class: "mono", "This review gives away the story." }
                    button {
                        r#type: "button",
                        class: "btn ghost sm",
                        "data-testid": "review-spoiler-reveal",
                        onclick: move |_| revealed.set(true),
                        "Show review"
                    }
                }
            } else {
                div {
                    class: if clipped { "bd-journal-entry-body bd-review-text is-clamped" } else { "bd-journal-entry-body bd-review-text" },
                    "data-testid": "review-text",
                    dangerous_inner_html: "{html}",
                }
                if clipped {
                    button {
                        r#type: "button",
                        class: "btn ghost sm bd-review-more",
                        "data-testid": "review-read-more",
                        "aria-expanded": "false",
                        onclick: move |_| expanded.set(true),
                        "Read more \u{2193}"
                    }
                }
            }
        }
    }
}

/// Every rating without text, as one row of avatars and stars.
#[component]
fn BdStarsOnlyRow(ratings: Vec<AttributedReview>) -> Element {
    rsx! {
        div { class: "bd-review-starsrow", "data-testid": "review-stars-only",
            span { class: "label bd-review-starsrow-k", "Also rated" }
            ul { class: "bd-review-starsrow-list", aria_label: "Ratings without a review",
                for rating in ratings {
                    li {
                        key: "{rating.user_id}",
                        class: "bd-review-starchip",
                        "data-testid": "review-stars-only-item",
                        title: "{chip_title(&rating)}",
                        UserAvatar {
                            user_id: rating.user_id,
                            name: rating.username.clone(),
                            has_avatar: rating.has_avatar,
                            class: "bd-review-chip-avatar",
                        }
                        span { class: "sr-only", "{rating.username}" }
                        if let Some(stars) = rating.stars {
                            StarRating { stars, extra_class: "bd-review-chip-stars".to_string() }
                        }
                    }
                }
            }
        }
    }
}

/// A stars-only chip's tooltip: who, and how many stars.
fn chip_title(rating: &AttributedReview) -> String {
    match rating.stars {
        Some(stars) => format!("{} \u{b7} {} \u{2605}", rating.username, fmt_stars(stars)),
        None => rating.username.clone(),
    }
}
