//! The shared loading vocabulary: the [`Loading`] block (page, stage, sheet,
//! section, row), the boot screen, busy buttons, skeletons, and the small
//! value/activity marks. Every surface that waits renders one of these; the
//! visuals live in `assets/loading.css`. All markup is identical on SSR and
//! the first WASM paint (rule 07) — nothing here reads platform state.

use dioxus::prelude::*;

/// Which surface a [`Loading`] block fills.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LoadingKind {
    /// Fills `main` under the nav while a route's data loads.
    Page,
    /// An opaque cover over a reader or player stage, with a retry slot.
    Stage,
    /// The body of a modal, sheet or drawer.
    Sheet,
    /// A block sized to its container: a card, a panel, a status line.
    #[default]
    Section,
    /// One list row — a "load more", a trailing page.
    Row,
}

/// Which mark a [`Loading`] block draws; `Auto` picks by kind.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LoadingMark {
    /// Riffle for page and stage, line for sheet and section, ring for row.
    #[default]
    Auto,
    /// The open book turning its leaves — reading.
    Riffle,
    /// The line of page ticks a crest runs along — also a waveform.
    Line,
    /// The small comet ring.
    Ring,
}

/// Size step shared by the three marks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MarkSize {
    Xs,
    Sm,
    #[default]
    Md,
    Lg,
    Xl,
}

impl MarkSize {
    /// The CSS size modifier; `Md` is each mark's unmodified base size.
    fn class(self) -> &'static str {
        match self {
            MarkSize::Xs => "xs",
            MarkSize::Sm => "sm",
            MarkSize::Md => "",
            MarkSize::Lg => "lg",
            MarkSize::Xl => "xl",
        }
    }
}

/// Crest heights for the line, one per tick, cycled. Fixed rather than random
/// so SSR and the client paint the same waveform.
const AMPLITUDES: [f32; 16] = [
    0.62, 0.88, 0.7, 1.0, 0.78, 0.55, 0.92, 0.66, 0.84, 0.58, 0.96, 0.72, 0.6, 0.9, 0.68, 0.8,
];

/// Inline custom properties for tick `i`: its place in the run and its crest.
fn tick_style(i: usize) -> String {
    format!("--i:{i};--a:{}", AMPLITUDES[i % AMPLITUDES.len()])
}

/// The comet ring — the mark for anything under ~24px.
#[component]
pub fn Ring(
    #[props(default = MarkSize::Sm)] size: MarkSize,
    #[props(into, default)] testid: Option<String>,
    #[props(into, default)] class: Option<String>,
) -> Element {
    let size = match size {
        MarkSize::Md => "md",
        other => other.class(),
    };
    let extra = class.unwrap_or_default();
    rsx! {
        span { class: "ld-ring {size} {extra}", "aria-hidden": "true", "data-testid": testid }
    }
}

/// The line: `ticks` page ticks with a crest running along them.
#[component]
pub fn Line(#[props(default = 16)] ticks: usize, #[props(default)] size: MarkSize) -> Element {
    let size = size.class();
    rsx! {
        span { class: "ld-line {size}", style: "--n:{ticks}", "aria-hidden": "true",
            for i in 0..ticks {
                i { key: "{i}", style: tick_style(i) }
            }
        }
    }
}

/// The riffle: an open book whose three leaves turn over the spine.
#[component]
pub fn Riffle(#[props(default)] size: MarkSize) -> Element {
    let size = size.class();
    rsx! {
        span { class: "ld-riffle {size}", "aria-hidden": "true",
            span { class: "ld-rf-book",
                span { class: "ld-rf-page l" }
                span { class: "ld-rf-page r" }
                for i in 0..3 {
                    span { key: "{i}", class: "ld-rf-leaf n{i}", style: "--i:{i}",
                        span { class: "ld-rf-face front" }
                        span { class: "ld-rf-face back" }
                    }
                }
            }
        }
    }
}

/// The mark `Auto` resolves to for each kind, at that kind's size.
fn default_mark(kind: LoadingKind, mark: LoadingMark) -> Element {
    let mark = match (mark, kind) {
        (LoadingMark::Auto, LoadingKind::Page | LoadingKind::Stage) => LoadingMark::Riffle,
        (LoadingMark::Auto, LoadingKind::Row) => LoadingMark::Ring,
        (LoadingMark::Auto, _) => LoadingMark::Line,
        (explicit, _) => explicit,
    };
    match (mark, kind) {
        (LoadingMark::Riffle, LoadingKind::Stage) => rsx! { Riffle { size: MarkSize::Lg } },
        (LoadingMark::Riffle, _) => rsx! { Riffle {} },
        (LoadingMark::Line, LoadingKind::Stage) => rsx! { Line { ticks: 32, size: MarkSize::Xl } },
        (LoadingMark::Line, LoadingKind::Sheet) => rsx! { Line { ticks: 20, size: MarkSize::Lg } },
        (LoadingMark::Line, LoadingKind::Row) => rsx! { Line { ticks: 10, size: MarkSize::Sm } },
        (LoadingMark::Line, _) => rsx! { Line { ticks: 14 } },
        (_, LoadingKind::Stage) => rsx! { Ring { size: MarkSize::Lg } },
        _ => rsx! { Ring {} },
    }
}

/// The CSS kind modifier.
fn kind_class(kind: LoadingKind) -> &'static str {
    match kind {
        LoadingKind::Page => "ld-page",
        LoadingKind::Stage => "ld-stage",
        LoadingKind::Sheet => "ld-sheet",
        LoadingKind::Section => "ld-section",
        LoadingKind::Row => "ld-row",
    }
}

/// A block loader: a mark and a caption, announced as a polite status.
///
/// `class` appends modifiers (`start`, `inline` on a section; `in-flow` on a
/// stage that replaces rather than covers) or a caller's legacy hook class;
/// `children` fill the slot under the caption (a stage's retry, a note).
#[component]
pub fn Loading(
    #[props(default)] kind: LoadingKind,
    #[props(default)] mark: LoadingMark,
    #[props(into, default = "Loading\u{2026}".to_string())] label: String,
    #[props(into, default)] testid: Option<String>,
    #[props(into, default)] class: Option<String>,
    children: Element,
) -> Element {
    let kind_cls = kind_class(kind);
    let extra = class.unwrap_or_default();
    rsx! {
        div {
            class: "ld {kind_cls} {extra}",
            role: "status",
            "aria-live": "polite",
            "data-testid": testid,
            {default_mark(kind, mark)}
            p { class: "ld-label", "{label}" }
            div { class: "ld-slot", {children} }
        }
    }
}

/// Pre-paint theme: the boot screen is the first thing a reader sees, so it
/// must already wear their theme. Runs once at parse time from the SSR markup;
/// hydration adopts the node and never re-runs it, and `init_theme` then
/// settles the signal onto the same value.
const BOOT_THEME_JS: &str = "(function(){try{var t=localStorage.getItem('omn.theme'),s=document.currentScript,r=s&&s.closest('.atrium');if(r&&/^(dark|black|light|sepia)$/.test(t||''))r.setAttribute('data-theme',t);}catch(e){}})();";

/// The wordmark, set letter by letter.
const WORDMARK: &str = "Omnibus";

/// The whole-app boot screen, shown until the client hydrates.
///
/// Rendered once at the app root on every target. CSS hides it the moment
/// [`use_hydration_marker`] stamps `data-hydrated` on `<html>`, so there is
/// no state to diverge between SSR and the first client paint.
#[component]
pub fn BootScreen() -> Element {
    rsx! {
        div {
            class: "ld-boot",
            role: "status",
            "aria-live": "polite",
            "aria-label": "Loading Omnibus",
            "data-testid": "boot-screen",
            script { dangerous_inner_html: BOOT_THEME_JS }
            div { class: "ld-boot-glow", "aria-hidden": "true" }
            div { class: "ld-boot-stack",
                Riffle { size: MarkSize::Lg }
                p { class: "ld-boot-word", "data-word": WORDMARK, "aria-hidden": "true",
                    for (i, ch) in WORDMARK.chars().enumerate() {
                        span { key: "{i}", style: "--i:{i}", "{ch}" }
                    }
                }
                Line { ticks: 28 }
                div { class: "ld-boot-notes",
                    p { class: "ld-label ld-boot-note first", "Finding your place" }
                    div { class: "ld-boot-note later",
                        p { class: "ld-label",
                            "Still opening \u{2014} the first visit after an update takes a moment"
                        }
                        // Reachable before any client code runs: an empty href
                        // resolves to this very URL, query string and all.
                        a { class: "ld-boot-retry", href: "", "Reload" }
                    }
                }
            }
            noscript {
                p { "Omnibus needs JavaScript to run." }
            }
        }
    }
}

/// Stamp `data-hydrated` on `<html>` once the client has mounted.
///
/// The boot screen keys its dismissal on this, and Playwright's `gotoReady`
/// waits for it. An effect, so it never runs during SSR.
pub fn use_hydration_marker() {
    use_effect(|| {
        dioxus::document::eval("document.documentElement.setAttribute('data-hydrated', '');");
    });
}

/// A button's label that swaps to `busy_label` with a ring while `busy`,
/// holding the wider of the two widths so the button never jumps.
///
/// The caller still owns `disabled` and `aria-busy` on the button itself.
#[component]
pub fn BusyLabel(
    busy: bool,
    #[props(into)] label: String,
    #[props(into)] busy_label: String,
) -> Element {
    rsx! {
        span { class: "ld-busy", "data-sizer": "{busy_label}",
            span { class: "ld-busy-face",
                if busy {
                    Ring { size: MarkSize::Xs }
                }
                span { if busy { "{busy_label}" } else { "{label}" } }
            }
        }
    }
}

/// Shape of one [`Skeleton`] plate.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SkeletonShape {
    /// A line of text, fully rounded.
    #[default]
    Line,
    /// A rectangular block.
    Block,
    /// A circle (an avatar).
    Circle,
    /// A 2:3 book cover with a spine.
    Cover,
}

/// One content-shaped placeholder plate. `index` staggers its glint so a set
/// of plates reads as one light crossing the page; `style` sizes it.
#[component]
pub fn Skeleton(
    #[props(default)] shape: SkeletonShape,
    #[props(default)] index: usize,
    #[props(into, default)] style: String,
) -> Element {
    let shape = match shape {
        SkeletonShape::Line => "line",
        SkeletonShape::Block => "block",
        SkeletonShape::Circle => "circle",
        SkeletonShape::Cover => "cover",
    };
    rsx! {
        span { class: "ld-skel {shape}", style: "--i:{index};{style}", "aria-hidden": "true" }
    }
}

/// A grid of cover skeletons, each with a title and author line under it.
#[component]
pub fn CoverSkeletons(
    #[props(default = 12)] count: usize,
    #[props(into, default)] testid: Option<String>,
) -> Element {
    rsx! {
        div { class: "ld-covers", "aria-hidden": "true", "data-testid": testid,
            for i in 0..count {
                div { key: "{i}", class: "ld-covers-cell",
                    Skeleton { shape: SkeletonShape::Cover, index: i }
                    Skeleton { index: i }
                    Skeleton { index: i }
                }
            }
        }
    }
}

/// Text-row skeletons (a list, a log, a table body): avatar, two lines, a meta
/// chip. Line widths vary deterministically so the rows don't read as a grid.
#[component]
pub fn RowSkeletons(
    #[props(default = 4)] count: usize,
    #[props(default = true)] avatar: bool,
    #[props(into, default)] testid: Option<String>,
) -> Element {
    let cols = if avatar { "36px 1fr auto" } else { "1fr auto" };
    rsx! {
        div { class: "ld-rows", style: "--row-cols:{cols}", "aria-hidden": "true", "data-testid": testid,
            for i in 0..count {
                div { key: "{i}", class: "ld-rows-row",
                    if avatar {
                        Skeleton { shape: SkeletonShape::Circle, index: i }
                    }
                    div { class: "ld-rows-text",
                        Skeleton { index: i, style: format!("--w:{}%", 58 + (i * 37) % 30) }
                        Skeleton { index: i, style: format!("--w:{}%;height:.7em", 28 + (i * 23) % 25) }
                    }
                    Skeleton { index: i, style: "--w:48px" }
                }
            }
        }
    }
}

/// A switch whose position isn't known yet: the knob waits at centre.
#[component]
pub fn UnknownToggle(
    #[props(into, default = "Checking\u{2026}".to_string())] label: String,
    #[props(into, default)] testid: Option<String>,
) -> Element {
    rsx! {
        span {
            class: "ld-toggle-unknown",
            role: "status",
            "aria-label": "{label}",
            "data-testid": testid,
        }
    }
}

/// A floating pill for non-blocking background work, announced politely.
#[component]
pub fn ActivityPill(
    #[props(into)] label: String,
    #[props(into, default)] testid: Option<String>,
    #[props(into, default)] class: Option<String>,
) -> Element {
    let extra = class.unwrap_or_default();
    rsx! {
        span {
            class: "ld-pill {extra}",
            role: "status",
            "aria-live": "polite",
            "data-testid": testid,
            Ring { size: MarkSize::Xs }
            span { "{label}" }
        }
    }
}

/// Keep `children` on screen, dimmed, while they refetch.
#[component]
pub fn Stale(
    stale: bool,
    #[props(into, default)] class: Option<String>,
    children: Element,
) -> Element {
    let extra = class.unwrap_or_default();
    rsx! {
        div {
            class: if stale { "ld-stale is-stale {extra}" } else { "ld-stale {extra}" },
            "aria-busy": if stale { "true" } else { "false" },
            {children}
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
