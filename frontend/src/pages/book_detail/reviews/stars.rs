//! The one-tap half-star picker on your review card: five stars, each split
//! into a left (x.5) and a right (x) target, with a hover preview. It only
//! reports the tapped value; the card decides whether that sets or clears.

use dioxus::prelude::*;

use crate::components::fmt_stars;

/// Five tappable stars showing `value`; `on_pick` gets the half-star tapped.
#[component]
pub(super) fn BdStarPicker(value: Option<f32>, on_pick: EventHandler<f32>) -> Element {
    let mut hover = use_signal(|| None::<f32>);
    // A hover preview wins over the saved value.
    let shown = hover().or(value).unwrap_or(0.0);
    rsx! {
        div {
            class: "bd-stars bd-stars-interactive",
            role: "group",
            aria_label: "Your rating",
            "data-testid": "review-stars",
            onmouseleave: move |_| hover.set(None),
            for slot in 1..=5u8 {
                span { key: "{slot}", class: "bd-star-slot",
                    span { class: "bd-star-bg", aria_hidden: "true", "\u{2605}" }
                    span {
                        class: "bd-star-fg",
                        aria_hidden: "true",
                        style: "width: {fill_percent(shown, f32::from(slot))}%",
                        "\u{2605}"
                    }
                    for (half, side) in [(f32::from(slot) - 0.5, "left"), (f32::from(slot), "right")] {
                        button {
                            key: "{side}",
                            r#type: "button",
                            class: "bd-star-half bd-star-half-{side}",
                            aria_label: "{half_star_label(half, value)}",
                            title: "{half_star_label(half, value)}",
                            onmouseenter: move |_| hover.set(Some(half)),
                            onclick: move |_| {
                                // The fill should show the answer, not the pointer.
                                hover.set(None);
                                on_pick.call(half);
                            },
                        }
                    }
                }
            }
        }
    }
}

/// How much of the star in `slot` (1..=5) a value of `shown` fills.
fn fill_percent(shown: f32, slot: f32) -> u32 {
    if shown >= slot {
        100
    } else if shown >= slot - 0.5 {
        50
    } else {
        0
    }
}

/// Accessible label and tooltip for one half star. The current rating's own
/// half clears it, so it says so rather than "Rate N stars" (#2352).
pub(super) fn half_star_label(value: f32, current: Option<f32>) -> String {
    if current == Some(value) {
        format!("Clear your {}-star rating", fmt_stars(value))
    } else if (value - 1.0).abs() < f32::EPSILON {
        "Rate 1 star".to_string()
    } else {
        format!("Rate {} stars", fmt_stars(value))
    }
}
