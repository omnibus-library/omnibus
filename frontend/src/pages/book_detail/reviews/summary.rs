//! The household's ratings summed up: the section's summary (average, how many
//! rated, the spread over the ten half-star values, drawn like the stats
//! page's rating histogram) and the title area's `★ 4.3 · 3 readers` link
//! into the section. Both render only when the server sends a summary; the
//! threshold for one is the server's, never recomputed here.

use dioxus::prelude::*;
use omnibus_shared::{ReviewBucket, ReviewSummary};

use crate::components::StarRating;
use crate::format::count_label;

/// The summary block.
#[component]
pub(super) fn BdReviewSummary(summary: ReviewSummary) -> Element {
    let bars = spread_bars(&summary.buckets);
    rsx! {
        div { class: "bd-review-summary", "data-testid": "review-summary",
            div { class: "bd-review-avg",
                span { class: "bd-review-avg-v", "data-testid": "review-summary-average",
                    "{average_label(summary.average_stars)}"
                }
                div { class: "bd-review-avg-side",
                    StarRating { stars: summary.average_stars, extra_class: "bd-review-avg-stars".to_string() }
                    span { class: "mono bd-review-avg-n", "data-testid": "review-summary-count",
                        "{count_label(summary.ratings, \"reader\")} in the household"
                    }
                }
            }
            div {
                class: "bd-review-spread",
                role: "img",
                aria_label: "{spread_summary(&summary.buckets)}",
                "data-testid": "review-spread",
                for bar in bars {
                    div { key: "{bar.half_stars}", class: "bd-review-spread-col", title: "{bar.title}",
                        div { class: "bd-review-spread-track",
                            // One element either way, so an empty slot and a
                            // bar swap a class rather than a node (rule 07).
                            div {
                                class: if bar.readers == 0 { "bd-review-spread-slot" } else { "bd-review-spread-bar" },
                                style: if bar.readers == 0 { String::new() } else { format!("height: {}%;", bar.height_pct) },
                            }
                        }
                        div { class: "mono bd-review-spread-label", "{bar.label}" }
                    }
                }
            }
        }
    }
}

/// The title area's read-only household rating, a jump to the Reviews
/// section. Nothing at all until there is a summary.
#[component]
pub(in crate::pages::book_detail) fn BdReviewsJumpLink(
    summary: Option<ReviewSummary>,
    on_jump: EventHandler<()>,
) -> Element {
    let Some(summary) = summary else {
        return rsx! {};
    };
    let average = average_label(summary.average_stars);
    let readers = count_label(summary.ratings, "reader");
    rsx! {
        button {
            r#type: "button",
            class: "bd-reviews-jump",
            "data-testid": "reviews-jump",
            aria_label: "Rated {average} by {readers} \u{2014} go to the reviews",
            onclick: move |_| on_jump.call(()),
            span { class: "bd-reviews-jump-star", aria_hidden: "true", "\u{2605}" }
            " {average} \u{b7} {readers}"
        }
    }
}

/// An average in stars to one decimal: `4.3`.
pub(super) fn average_label(stars: f32) -> String {
    format!("{:.1}", (stars * 10.0).round() / 10.0)
}

/// One column of the spread.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct SpreadBar {
    pub(super) half_stars: i64,
    pub(super) readers: i64,
    /// Height against the fullest bucket, 0..=100.
    pub(super) height_pct: u32,
    /// Whole stars only; the half columns between them go unlabelled.
    pub(super) label: String,
    pub(super) title: String,
}

/// The ten buckets as bars scaled to the fullest one.
pub(super) fn spread_bars(buckets: &[ReviewBucket]) -> Vec<SpreadBar> {
    let max = buckets.iter().map(|b| b.readers).max().unwrap_or(0).max(1);
    buckets
        .iter()
        .map(|b| {
            let pct = (b.readers.max(0) * 100 + max / 2) / max;
            SpreadBar {
                half_stars: b.half_stars,
                readers: b.readers.max(0),
                height_pct: u32::try_from(pct.clamp(0, 100)).unwrap_or(0),
                label: if b.half_stars % 2 == 0 {
                    (b.half_stars / 2).to_string()
                } else {
                    String::new()
                },
                title: format!(
                    "{} \u{2605} \u{b7} {}",
                    stars_label(b.half_stars),
                    count_label(b.readers, "reader")
                ),
            }
        })
        .collect()
}

/// The spread's text alternative: each value someone gave, lowest first.
pub(super) fn spread_summary(buckets: &[ReviewBucket]) -> String {
    let given: Vec<String> = buckets
        .iter()
        .filter(|b| b.readers > 0)
        .map(|b| {
            format!(
                "{} at {}",
                count_label(b.readers, "reader"),
                stars_label(b.half_stars)
            )
        })
        .collect();
    if given.is_empty() {
        return "Ratings by stars: none.".to_string();
    }
    format!("Ratings by stars: {}.", given.join(", "))
}

/// Half stars as stars: `9` → `4.5`, `8` → `4`.
fn stars_label(half_stars: i64) -> String {
    if half_stars % 2 == 0 {
        (half_stars / 2).to_string()
    } else {
        format!("{}.5", half_stars / 2)
    }
}
