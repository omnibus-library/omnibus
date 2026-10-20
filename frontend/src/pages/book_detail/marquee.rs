//! Marquee book-detail stage (web): the cover pinned huge on the left, seven
//! sections in a translucent panel on the right, a dot-rail TOC. The panel
//! reads two ways on the viewer's `book_detail_scroll_stops` preference — off
//! (the default) is one continuous flow, on is the snapped marquee, same
//! content either way. A switch in the stage's top-right corner flips it in
//! place.
//! `flow.js` and `marquee.js` run both readings after mount.

use dioxus::prelude::*;
use omnibus_shared::progress::ProgressFormat;
use omnibus_shared::{
    AlignmentView, BookInsights, EbookMetadata, ProgressRecord, SeriesDetail, SuggestionsResponse,
};

use crate::components::atrium::Cover;
use crate::data;

use super::body::BdPageCtx;
use super::highlights::{BdHighlightsSection, BdQuoteMeta};
use super::journal::MarqueeJournalStop;
use super::reviews::{use_book_reviews, BdReviewsSection, ReviewsCtx};
use super::rule_facts::RuleFactsSaved;
use super::view::LoadedBookView;
use super::PhysSignals;

mod files;
mod home;
mod more;
mod stats;

#[cfg(test)]
mod tests;

/// The seven stops, in running order. The label pair is `NN` + name — the
/// section label renders `NN / 07 — Name` and the dot rail `NN · Name`.
// The shelf has no stop of its own: books beside this one sit under `More`,
// the one place the page points away from the book it is about.
pub(super) const MARQUEE_SECTIONS: [(&str, &str); 7] = [
    ("01", "Home"),
    ("02", "Stats"),
    ("03", "Reviews"),
    ("04", "Highlights"),
    ("05", "Journals"),
    ("06", "The files"),
    ("07", "More"),
];

/// The Reviews stop's place in [`MARQUEE_SECTIONS`], where the title area's
/// household rating jumps to.
pub(super) const REVIEWS_STOP: usize = 2;

/// Scroll-mechanics glue for the snapped marquee (parallax, dot tracking,
/// dot-rail navigation).
const MARQUEE_JS: &str = include_str!("marquee.js");

/// The same glue for the continuous flow — drift, section tracking, jump
/// navigation, and the back-to-the-book pill.
const FLOW_JS: &str = include_str!("flow.js");

/// Everything the stage needs beyond the book itself, bundled to keep the
/// component under the prop-count guideline (mirrors `view::LoadedCtx`).
#[derive(Clone, PartialEq, Props)]
pub(super) struct MarqueeStageCtx {
    pub server_url: String,
    pub is_admin: bool,
    pub refresh: Signal<u32>,
    pub after_merge: Signal<bool>,
}

/// Prebuilt admin rail actions (Merge / Delete dialogs' openers), threaded
/// into the files stop.
#[derive(Clone, PartialEq, Props)]
pub(super) struct MarqueeAdminActions {
    pub merge_button: Option<Element>,
    pub delete_button: Option<Element>,
}

/// The full marquee stage. Owns the page-wide fetches the stops share (reading /
/// listening progress and per-book insights) plus the post-mount scroll glue;
/// each stop fetches its own section data (series, shelves, journal,
/// highlights, physical copies) exactly as the sections it absorbed did.
#[component]
pub(super) fn MarqueeStage(
    b: EbookMetadata,
    view: MarqueeViewFacts,
    author_books: Option<Vec<EbookMetadata>>,
    suggestions: Option<SuggestionsResponse>,
    admin: MarqueeAdminActions,
    phys: PhysSignals,
    ctx: MarqueeStageCtx,
) -> Element {
    let uuid = b.unique_identifier.clone().unwrap_or_default();
    // The page's writers count each save on it here; the More stop's shelves
    // re-read on the count.
    use_context_provider(RuleFactsSaved::new);
    // The Reviews stop and the title area's household rating share one fetch.
    let reviews = use_book_reviews(uuid.clone());

    // Page-wide data: newest saved position per format + session insights.
    // Seeded `None` on SSR and the first WASM paint (rule 07); post-mount
    // effects fill them in. A monotonic sequence guards against a slow fetch
    // for a previous book landing after a fast SPA navigation.
    let mut reading = use_signal(|| None::<ProgressRecord>);
    let mut listening = use_signal(|| None::<ProgressRecord>);
    let mut insights = use_signal(|| None::<BookInsights>);
    // The alignment view doubles as the chapter table + audio timeline for
    // the Home stop's CTA labels and ruler ticks — fetched for any book with
    // files, not just dual-format ones.
    let mut alignment = use_signal(|| None::<AlignmentView>);
    // The series, fetched once for the stage: the Home kicker names "Book N
    // of M" from its count and the Shelf stop lays its members out.
    let mut series = use_signal(|| None::<SeriesDetail>);
    // True once the stage fetch below has returned, so a `None` above can be
    // told apart: still asking, or answered with nothing.
    let mut stage_loaded = use_signal(|| false);
    let mut load_seq = use_signal(|| 0u64);
    {
        let uuid = uuid.clone();
        let has_text = view.has_ebook || view.has_comic || view.has_pdf;
        let has_audio = view.has_audio;
        let series_id = b.series_id;
        let refresh = ctx.refresh;
        use_effect(use_reactive!(|uuid| {
            let _ = refresh();
            let my_load = *load_seq.peek() + 1;
            load_seq.set(my_load);
            reading.set(None);
            listening.set(None);
            insights.set(None);
            alignment.set(None);
            series.set(None);
            stage_loaded.set(false);
            let uuid = uuid.clone();
            spawn(async move {
                let read = if has_text {
                    data::get_progress("", &uuid, ProgressFormat::Epub)
                        .await
                        .ok()
                        .flatten()
                } else {
                    None
                };
                let listen = if has_audio {
                    data::get_progress("", &uuid, ProgressFormat::Audio)
                        .await
                        .ok()
                        .flatten()
                } else {
                    None
                };
                let ins = data::get_book_insights(&uuid).await.ok().flatten();
                let ser = match series_id {
                    Some(id) => data::get_series("", id).await.ok().flatten(),
                    None => None,
                };
                let align = if has_text || has_audio {
                    data::get_alignment("", &uuid).await.ok()
                } else {
                    None
                };
                if *load_seq.peek() == my_load {
                    reading.set(read);
                    listening.set(listen);
                    insights.set(ins);
                    alignment.set(align);
                    series.set(ser);
                    stage_loaded.set(true);
                }
            });
        }));
    }

    // Which way the panel reads. `None` until the viewer resolves — on SSR
    // and the first WASM paint alike — so both render the flow, the default
    // this preference ships as (rule 07).
    let viewer = crate::use_current_user_summary();
    let scroll_stops = use_memo(move || viewer().is_some_and(|u| u.book_detail_scroll_stops));
    let (mode_view, on_mode_toggle) = use_scroll_stops_toggle();

    // Install the scroll glue after mount and re-run it when the book or mode
    // changes, replacing the other mode's listeners. A new book opens at the
    // top; a flip keeps the reader's section. The eval is a no-op on SSR.
    {
        let uuid = uuid.clone();
        let mut glued_book = use_signal(String::new);
        use_effect(use_reactive!(|uuid, scroll_stops| {
            let flip = *glued_book.peek() == uuid;
            glued_book.set(uuid.clone());
            let glue = if scroll_stops() { MARQUEE_JS } else { FLOW_JS };
            let _ =
                dioxus::document::eval(&format!("window.__omnibusMarqueeKeep = {flip};\n{glue}"));
        }));
    }

    // Wishlist-only books (no files, tracked entry) override the Home /
    // Stats / Highlights / Journals stops with the design's empty states.
    // The entry arrives post-mount via the shared `phys` signals, so SSR and
    // the first client paint both render the default stops (rule 07).
    let is_fileless = b.formats.is_empty();
    let wishlist = phys.wishlist.read().clone();
    let wish_mode = is_fileless && wishlist.is_some();

    let quote_meta = BdQuoteMeta {
        title: view.title.clone(),
        author: view.primary_author.clone(),
        accent: b.accent.clone(),
    };

    let stops: [Element; 7] = [
        rsx! {
            home::MarqueeHomeStop {
                b: b.clone(),
                view: view.clone(),
                progress: MarqueeProgress { reading: reading(), listening: listening() },
                insights: insights(),
                alignment: alignment(),
                series_total: series().map(|s| s.book_count),
                phys,
                refresh: ctx.refresh,
                after_merge: ctx.after_merge,
                wishlist: wishlist.clone(),
                reviews,
            }
        },
        rsx! {
            stats::MarqueeStatsStop {
                uuid: uuid.clone(),
                insights: insights(),
                loaded: stage_loaded(),
                progress: MarqueeProgress { reading: reading(), listening: listening() },
                audio_only: view.has_audio && !view.has_ebook && !view.has_comic && !view.has_pdf,
                wish_mode,
            }
        },
        rsx! {
            MarqueeReviewsStop { uuid: uuid.clone(), reviews }
        },
        rsx! {
            if wish_mode {
                div { class: "bdmq-k", "Kept lines \u{b7} none" }
                div { class: "bdmq-bigquiet", "Highlight while you read to keep lines here." }
                p { class: "mono bdmq-quiet-hint", "find a copy first \u{2014} check in when it arrives" }
            } else {
                BdHighlightsSection { uuid: uuid.clone(), quote_meta }
            }
        },
        rsx! {
            MarqueeJournalStop { uuid: uuid.clone(), wish_mode }
        },
        rsx! {
            files::MarqueeFilesStop {
                b: b.clone(),
                view: view.clone(),
                admin: admin.clone(),
                phys,
                refresh: ctx.refresh,
                is_fileless,
            }
        },
        rsx! {
            more::MarqueeMoreStop {
                b: b.clone(),
                view: view.clone(),
                ctx: more::MoreStopCtx {
                    series: series(),
                    series_loaded: stage_loaded(),
                    author_books: author_books.clone(),
                    suggestions,
                    page: BdPageCtx {
                        server_url: ctx.server_url.clone(),
                        is_admin: ctx.is_admin,
                    },
                    wishlist: phys.wishlist,
                    wishlist_loaded: phys.loaded,
                },
            }
        },
    ];

    rsx! {
        div { class: "bdmq-stage", id: "bdmq-stage",
            div { class: "bdmq-coverwrap", aria_hidden: "true",
                div { class: "bdmq-coverpx", id: "bdmq-coverpx",
                    Cover { book: b.clone() }
                }
            }
            DotRail {}
            ScrollStopsToggle { view: mode_view, on_toggle: on_mode_toggle }
            // One stable element around the mode swap, so the toggle beside it
            // stays mounted, focused and live across a flip (rule 07).
            div { class: "bdmq-mode",
                if scroll_stops() {
                    div { class: "bdmq-snap", id: "bdmq-snap",
                        for (i, (no, name)) in MARQUEE_SECTIONS.iter().enumerate() {
                            section {
                                key: "{no}",
                                class: "bdmq-sec",
                                "data-testid": "bdmq-sec-{i}",
                                div { class: "bdmq-seclab", "{no} / 07 \u{2014} " b { "{name}" } }
                                // A filter on the panel would capture every fixed overlay inside it.
                                div { class: "bdmq-panelscrim", aria_hidden: "true" }
                                div { class: "bdmq-panel",
                                    div { class: "bdmq-panel-inner", {stops[i].clone()} }
                                }
                                if i < MARQUEE_SECTIONS.len() - 1 {
                                    div { class: "bdmq-next", aria_hidden: "true",
                                        "scroll \u{2014} next: {MARQUEE_SECTIONS[i + 1].1}"
                                        span { class: "arr", "\u{2193}" }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // A filter on the scroller would capture every fixed overlay inside it.
                    div { class: "bdmq-flowscrim", aria_hidden: "true" }
                    div { class: "bdmq-flowscroll", id: "bdmq-flow",
                        div { class: "bdmq-flow",
                            for (i, (no, name)) in MARQUEE_SECTIONS.iter().enumerate() {
                                section {
                                    key: "{no}",
                                    class: if i == 0 { "bdmq-flowsec lead" } else { "bdmq-flowsec" },
                                    "data-testid": "bdmq-sec-{i}",
                                    // The first section is the book itself, so it
                                    // is not announced — its own title is the
                                    // heading, and a "01 HOME" rule above it would
                                    // label the page rather than a section of it.
                                    if i > 0 {
                                        div { class: "bdmq-flowlab",
                                            "{no}"
                                            b { "{name}" }
                                            i { class: "rule", aria_hidden: "true" }
                                        }
                                    }
                                    div { class: "bdmq-flowbody", {stops[i].clone()} }
                                }
                            }
                        }
                    }
                    button {
                        r#type: "button",
                        class: "bdmq-flowtop",
                        id: "bdmq-flowtop",
                        "data-testid": "bdmq-flowtop",
                        "\u{2191} back to the book"
                    }
                }
            }
        }
    }
}

/// Stop 03 · Reviews: the counts kicker over the section, whose composer opens
/// over the stage like the journal's. Every book can be reviewed, so a
/// wishlist-only one gets the live section rather than an empty state.
#[component]
fn MarqueeReviewsStop(uuid: String, reviews: ReviewsCtx) -> Element {
    rsx! {
        div { class: "bdmq-k", "data-testid": "reviews-kicker",
            match reviews.kicker() {
                Some(kicker) => rsx! { "{kicker}" },
                None => rsx! { span { class: "ld-sheen", "Counting reviews" } },
            }
        }
        BdReviewsSection { uuid, ctx: reviews, overlay_composer: true }
    }
}

/// Take the reader to stop `index` through its dot, so the jump moves
/// whichever reading the panel is in exactly as the rail does. A no-op off
/// the web, where there is no rail.
pub(super) fn jump_to_stop(index: usize) {
    #[cfg(feature = "web")]
    {
        let _ = dioxus::document::eval(&format!(
            "document.querySelector('[data-testid=\"bdmq-dot-{index}\"]')?.click();"
        ));
    }
    #[cfg(not(feature = "web"))]
    let _ = index;
}

/// The dot-rail TOC: one button per stop, the first marked current. The
/// scroll glue moves the marker and wires the jumps.
#[component]
fn DotRail() -> Element {
    rsx! {
        nav { class: "bdmq-dots", "aria-label": "Page sections", "data-testid": "bdmq-dots",
            for (i, (no, name)) in MARQUEE_SECTIONS.iter().enumerate() {
                button {
                    key: "{no}",
                    r#type: "button",
                    class: if i == 0 { "bdmq-dotrow on" } else { "bdmq-dotrow" },
                    title: "{name}",
                    "data-testid": "bdmq-dot-{i}",
                    i {}
                    span { class: "lb", "{no} \u{b7} {name}" }
                }
            }
        }
    }
}

/// Shown when a save fails; the toggle has already gone back.
const SCROLL_STOPS_SAVE_ERROR: &str = "Couldn't save scroll stops. Try again.";

/// What the scroll-stops toggle shows this render.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct ScrollStopsView {
    /// The viewer's saved preference.
    on: bool,
    /// `/me` has resolved; until then `on` is only the default.
    ready: bool,
    /// The last save failed; the next press clears it.
    failed: bool,
}

/// The stage's Scroll stops switch, pinned to its top-right corner and pressed
/// while the panel snaps section by section. Until the viewer resolves it is
/// inert and claims neither reading (rule 12).
#[component]
fn ScrollStopsToggle(view: ScrollStopsView, on_toggle: EventHandler<()>) -> Element {
    let pressed = view.ready.then_some(if view.on { "true" } else { "false" });
    rsx! {
        div { class: "bdmq-modebar",
            button {
                r#type: "button",
                class: "bdmq-mode-toggle",
                "data-testid": "bdmq-mode-toggle",
                "aria-pressed": pressed,
                title: "Snap through the page one section at a time",
                disabled: !view.ready,
                onclick: move |_| on_toggle.call(()),
                "Scroll stops"
                span {
                    class: if view.ready { "bdmq-mode-sw" } else { "bdmq-mode-sw ld-toggle-unknown" },
                    aria_hidden: true,
                }
            }
            if view.failed {
                span { class: "bdmq-mode-error", role: "alert", "data-testid": "bdmq-mode-error",
                    "{SCROLL_STOPS_SAVE_ERROR}"
                }
            }
        }
    }
}

/// The toggle's state and press handler. It flips the cached viewer (the stage
/// re-renders in the other mode at once), saves, and flips back if refused,
/// through the same save the Preferences switch makes.
fn use_scroll_stops_toggle() -> (ScrollStopsView, EventHandler<()>) {
    use crate::pages::account::user_settings::{toggle, SaveState, UserSetting};

    let state = use_signal(|| SaveState::Idle);
    let viewer = crate::use_current_user().0;
    let saved = match &*viewer.read() {
        Some(Some(user)) => Some(user.book_detail_scroll_stops),
        _ => None,
    };
    let view = ScrollStopsView {
        on: saved.unwrap_or(false),
        ready: saved.is_some(),
        failed: state() == SaveState::Failed,
    };
    let on_toggle = EventHandler::new(move |_: ()| toggle(UserSetting::ScrollStops, viewer, state));
    (view, on_toggle)
}

/// Display facts shared by every stop, derived once in `view.rs` from the
/// loaded book. Cloneable so each stop takes its own copy.
#[derive(Clone, PartialEq)]
pub(super) struct MarqueeViewFacts {
    pub title: String,
    pub primary_author: String,
    pub author_id: Option<i64>,
    pub authors_line: String,
    pub series: Option<String>,
    pub has_ebook: bool,
    pub has_audio: bool,
    pub has_comic: bool,
    pub has_pdf: bool,
}

impl MarqueeViewFacts {
    pub(super) fn from_loaded(v: &LoadedBookView) -> Self {
        Self {
            title: v.title.clone(),
            primary_author: v.primary_author.clone(),
            author_id: v.author_id,
            authors_line: v.authors_line.clone(),
            series: v.series.clone(),
            has_ebook: v.has_ebook,
            has_audio: v.has_audio,
            has_comic: v.has_comic,
            has_pdf: v.has_pdf,
        }
    }
}

/// The newest saved position per format, threaded into the Home and Stats
/// stops. Either side is `None` until the post-mount fetch resolves — or
/// forever, for a format the reader has never opened.
#[derive(Clone, PartialEq)]
pub(super) struct MarqueeProgress {
    pub reading: Option<ProgressRecord>,
    pub listening: Option<ProgressRecord>,
}

impl MarqueeProgress {
    /// Whole-book percent from the freshest format that carries one.
    pub(super) fn newest_percent(&self) -> Option<i64> {
        let read = self
            .reading
            .as_ref()
            .and_then(|r| r.progress_percent.map(|p| (r.client_updated_at, p)));
        let listen = self
            .listening
            .as_ref()
            .and_then(|l| l.progress_percent.map(|p| (l.client_updated_at, p)));
        match (read, listen) {
            (Some((rt, rp)), Some((lt, lp))) => Some(if lt > rt { lp } else { rp }),
            (Some((_, p)), None) | (None, Some((_, p))) => Some(p),
            (None, None) => None,
        }
    }

    /// Unix seconds of the freshest saved position, if any.
    pub(super) fn newest_updated_at(&self) -> Option<i64> {
        let read = self.reading.as_ref().map(|r| r.client_updated_at);
        let listen = self.listening.as_ref().map(|l| l.client_updated_at);
        read.into_iter().chain(listen).max()
    }
}
