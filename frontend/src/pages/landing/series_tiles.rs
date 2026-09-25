//! The two cells a series stack adds to the landing grid: [`StackTile`], the
//! folded series (fanned covers, a count badge, progress segments), and
//! [`StackCap`], the head card that takes its cell once it is dealt out.

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{EbookMetadata, SeriesStack};

use super::grid::{stagger_ms, TILE_SIZES};
use super::series_grid::{band_style, stack_leaves, stack_segments};
use super::sorting::slugify;
use crate::Route;

/// A folded series: up to three covers fanned (front first), a count badge,
/// and a progress segment per volume once one is started. A click — or
/// Enter/Space — deals it out through `on_open(lead_uuid)`. `refocus` takes
/// focus on mount: the tile just returned from a fold, whose Fold up button
/// held focus and vanished. Wrapped in its own `listitem` cell so the grid's
/// `role="list"` owns only list items; the control inside stays a button.
#[component]
pub(super) fn StackTile(
    stack: SeriesStack,
    server_url: String,
    index: usize,
    refocus: Signal<Option<String>>,
    on_open: EventHandler<String>,
) -> Element {
    let front = stack.front().cloned().unwrap_or_default();
    let n = stack.members.len();
    let name = stack.name.clone();
    let slug = slugify(&name);
    let author = front
        .creators
        .first()
        .map(|c| c.name.clone())
        .unwrap_or_default();
    let meta = if author.is_empty() {
        format!("{n} books")
    } else {
        format!("{n} books · {author}")
    };
    let accent = front
        .accent
        .as_deref()
        .map(|a| format!(" --accent: {a};"))
        .unwrap_or_default();
    let leaves = stack_leaves(&stack);
    let segments = stack_segments(&stack);
    let lead_click = stack.lead_uuid.clone();
    let lead_key = stack.lead_uuid.clone();
    let take_focus = refocus.peek().as_deref() == Some(stack.lead_uuid.as_str());

    rsx! {
        div { class: "ss-cell", role: "listitem", "data-flip-key": "stack-{stack.lead_uuid}",
            a {
                class: "cover-link lib-tile ss-stack",
                "data-testid": "series-stack-{slug}",
                role: "button",
                tabindex: "0",
                "aria-expanded": "false",
                aria_label: "{name}, {n} books",
                title: "{name} · {n} books",
                style: "animation-delay: {stagger_ms(index)}ms;{accent}",
                onmounted: move |evt: MountedEvent| {
                    if take_focus {
                        crate::focus_after_paint::focus_after_paint(&evt);
                        let mut spent = refocus;
                        spent.set(None);
                    }
                },
                onclick: move |_| on_open.call(lead_click.clone()),
                onkeydown: move |evt: Event<KeyboardData>| {
                    let key = evt.key();
                    if key == Key::Enter || key == Key::Character(" ".to_string()) {
                        evt.prevent_default();
                        on_open.call(lead_key.clone());
                    }
                },
                span { class: "lib-tile-art ss-art",
                    for (depth, leaf) in leaves.into_iter().enumerate() {
                        StackLeaf { key: "{depth}", book: leaf, server_url: server_url.clone(), depth }
                    }
                }
                span { class: "ss-count", {stack_glyph()} "{n} books" }
                if let Some(fills) = segments {
                    span { class: "ss-segs", aria_hidden: true,
                        for (slot, pct) in fills.into_iter().enumerate() {
                            i { key: "{slot}", b { style: "width: {pct}%" } }
                        }
                    }
                }
                span { class: "lib-tile-cap",
                    span { class: "lib-tile-title", "{name}" }
                    span { class: "lib-tile-author", "{meta}" }
                }
            }
        }
    }
}

/// One fanned cover. Its own component so each leaf reads its own cover
/// cache-bust counter, as a grid tile does.
#[component]
fn StackLeaf(book: EbookMetadata, server_url: String, depth: usize) -> Element {
    let uuid = book.unique_identifier.clone().unwrap_or_default();
    let bust = crate::contexts::cover_bust_for(crate::contexts::use_cover_cache_bust().0, &uuid);
    let (src, srcset) = crate::components::cover_tile::thumb_srcs(&book, &uuid, &server_url, bust);
    // Back leaves sit under the front one.
    let z = 3usize.saturating_sub(depth);
    rsx! {
        span { class: "ss-leaf", style: "--i: {depth}; z-index: {z};",
            crate::components::atrium::Cover {
                book,
                src_override: src,
                srcset,
                sizes: Some(TILE_SIZES.to_string()),
            }
        }
    }
}

/// The head card a dealt-out stack opens on: the series name, how many of its
/// books are in the library (the app knows no series total, so it never
/// claims one), the series page, and Fold up — which takes focus, so Escape
/// and Enter reach the run without a click. It is itself the grid's
/// `listitem` cell, so no separate control needs a `role`.
#[component]
pub(super) fn StackCap(stack: SeriesStack, on_fold: EventHandler<()>) -> Element {
    let front = stack.front().cloned().unwrap_or_default();
    let n = stack.members.len();
    let author = front
        .creators
        .first()
        .map(|c| c.name.clone())
        .unwrap_or_default();
    let band = band_style(&stack);
    rsx! {
        div {
            class: "ss-cap",
            role: "listitem",
            "data-testid": "series-cap",
            "data-flip-key": "cap-{stack.lead_uuid}",
            style: "{band}",
            span { class: "ss-cap-k", "Series" }
            h3 { class: "ss-cap-name", "{stack.name}" }
            span { class: "ss-cap-meta",
                "{n} in your library"
                if !author.is_empty() {
                    br {}
                    "{author}"
                }
            }
            span { class: "ss-cap-acts",
                if let Some(id) = stack.series_id {
                    Link {
                        to: Route::SeriesDetail { id },
                        class: "ss-cap-go",
                        "data-testid": "series-cap-page",
                        "Series page →"
                    }
                }
                button {
                    r#type: "button",
                    class: "ss-cap-fold",
                    "data-testid": "series-cap-fold",
                    onmounted: move |evt: MountedEvent| crate::focus_after_paint::focus_after_paint(&evt),
                    onclick: move |_| on_fold.call(()),
                    "Fold up "
                    kbd { "esc" }
                }
            }
        }
    }
}

/// Two offset sheets — the count badge's mark.
fn stack_glyph() -> Element {
    rsx! {
        svg {
            width: "10", height: "10", view_box: "0 0 10 10",
            fill: "none", stroke: "currentColor", stroke_width: "1.2",
            "aria-hidden": "true",
            rect { x: "1", y: "3", width: "5.5", height: "6.5", rx: "0.8" }
            path { d: "M3.5 1.2h5v6.3" }
        }
    }
}
