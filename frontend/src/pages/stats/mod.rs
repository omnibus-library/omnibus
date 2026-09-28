//! Reading-stats page (`/stats`). The page is split on the one boundary the
//! payload itself draws: figures the period switcher governs sit inside the
//! "In this window" band, and figures that are true right now — the streak,
//! the goals, the trailing-year heatmap, the library — sit outside it, so a
//! reader can see what a period switch will and won't move.

use dioxus::prelude::*;
use omnibus_shared::{
    HouseholdReader, LibraryComposition, LibrarySize, ResumePoint, StatsRange, StatsSummary,
    STATS_TTL_SECS,
};

use crate::components::{Loading, LoadingKind, PageError};
use crate::data::DataError;
use crate::{data, use_server_url, Route};

mod clock;
mod composition;
mod donut;
mod drill_in;
mod goal;
mod heatmap;
mod hero;
mod library;
mod monthly;
mod picker;
mod reading_now;
mod superlatives;
mod tiles;

use clock::ReadingClock;
use composition::LibraryCompositionPanels;
use donut::GenreDonut;
use drill_in::{DrillIn, Metric};
use heatmap::HeatmapCard;
use hero::StatsHero;
use library::LibrarySizeHero;
use monthly::MonthlyChart;
use picker::{viewing, ReaderPicker, Viewing};
use reading_now::{InProgressCard, RecentlyFinishedCard};
use superlatives::StandoutsGrid;
use tiles::HeadlineTiles;

/// How many in-progress books the standing band lists.
const IN_PROGRESS_LIMIT: i64 = 3;

/// Which scope the page is showing: the reader's own figures, or the shelf's.
///
/// Two rather than three, because scope is the only real boundary left — the
/// period switcher governs every user-scoped module on the page and none of
/// the library ones, so a third tab would split one governed set in half.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope {
    User,
    Library,
}

/// Group a non-negative integer's digits in threes with `,` separators.
/// Negative inputs (never produced by `db::stats`) fall back to a plain
/// `to_string` rather than mangling the sign.
fn group_thousands(n: i64) -> String {
    if n < 0 {
        return n.to_string();
    }
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

/// Full month name for a 1-based month number — the window label reads as
/// prose ("August 2026"), where the heatmap's ruler wants the abbreviation.
fn month_name(m: i64) -> &'static str {
    match m {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        _ => "December",
    }
}

/// What the switcher's current window actually covers, spelled out under the
/// band's label — "August 2026 · month to date".
///
/// Anchored to the server's `as_of_day` rather than a client clock, for the
/// same reason the goal band's year is: a client-derived date in markup is a
/// hydration hazard (rule 07), and the two sides would disagree across a
/// timezone gap. Falls back to the range's own label when the summary carries
/// no day — a server too old to send one.
fn window_label(range: StatsRange, as_of_day: &str) -> String {
    let Some((y, m, _)) = heatmap::day_number(as_of_day).map(heatmap::civil_from_days) else {
        return range.label().to_string();
    };
    match range {
        StatsRange::Week => {
            let n = heatmap::day_number(as_of_day).unwrap_or(0);
            // Unix day 0 is a Thursday, so Monday-aligning subtracts (n+3)%7 —
            // the same convention `db::stats` buckets its weeks on.
            let (wy, wm, wd) = heatmap::civil_from_days(n - (n + 3).rem_euclid(7));
            format!(
                "Week of {wd} {} {wy} \u{00B7} to date",
                heatmap::month_abbr(wm)
            )
        }
        StatsRange::Month => format!("{} {y} \u{00B7} month to date", month_name(m)),
        StatsRange::Year => format!("{y} \u{00B7} year to date"),
        StatsRange::AllTime => "Everything you have tracked".to_string(),
    }
}

/// Reading-stats page — owns what a reader switch never touches (the period
/// pill, the User/Library scope, the library-scale fetches, the household
/// list) and hands the viewed reader off to [`ReaderStats`], keyed so a
/// switch remounts fresh rather than showing a moment of the previous
/// reader's figures.
#[component]
pub fn StatsPage(user: Option<i64>) -> Element {
    let server_url = use_server_url();
    // Every signal below is seeded to the same value on every target so SSR
    // and the first WASM paint agree (rule 07); nothing is read from
    // localStorage or a client clock at render time.
    let range = use_signal(StatsRange::default);
    let scope = use_signal(|| Scope::User);
    // Library-scale rather than per-user, so these ride their own fetches:
    // folding them into the summary would recompute and re-send them on every
    // switcher change. `None` until they land, and their cards show loading.
    let library_size: Signal<Option<LibrarySize>> = use_signal(|| None);
    let library_composition: Signal<Option<LibraryComposition>> = use_signal(|| None);
    // `None` while the list is in flight; an empty `Vec` (never refetched per
    // reader) once it lands or fails.
    let readers: Signal<Option<Vec<HouseholdReader>>> = use_signal(|| None);
    use_library_size_fetch_effect(server_url.clone(), library_size);
    use_library_composition_fetch_effect(server_url.clone(), library_composition);
    use_household_readers_fetch_effect(server_url.clone(), readers);

    rsx! {
        ReaderStats {
            user,
            range,
            scope,
            readers,
            library_size,
            library_composition,
        }
    }
}

/// One viewed reader's figures — the standing hero, the scope switcher, and
/// the two bands beneath it. `user` changing is reactive (`use_reactive!`,
/// not a keyed remount — a `key` on a single non-list child is a no-op in
/// Dioxus's diffing, so a plain prop change is the only signal a reader
/// switch gets): [`use_reader_switch_reset_effect`] blanks this reader's
/// signals and re-shows the page loader the instant it happens, and each
/// fetch effect below is reactive on `user` too, so it actually refetches
/// rather than only ever firing once at mount.
#[component]
fn ReaderStats(
    user: Option<i64>,
    range: Signal<StatsRange>,
    scope: Signal<Scope>,
    readers: Signal<Option<Vec<HouseholdReader>>>,
    library_size: Signal<Option<LibrarySize>>,
    library_composition: Signal<Option<LibraryComposition>>,
) -> Element {
    let server_url = use_server_url();
    let period: Signal<Option<StatsSummary>> = use_signal(|| None);
    let all_time: Signal<Option<StatsSummary>> = use_signal(|| None);
    let in_progress: Signal<Vec<ResumePoint>> = use_signal(Vec::new);
    let loading = use_signal(|| true);
    let error: Signal<Option<Failure>> = use_signal(|| None);
    // Which tile's drill-in is open, if any — the sheet only ever opens from a
    // client click.
    let expanded: Signal<Option<Metric>> = use_signal(|| None);
    use_reader_switch_reset_effect(
        user,
        period,
        all_time,
        in_progress,
        loading,
        error,
        expanded,
    );
    use_period_fetch_effect(server_url.clone(), user, range, period, error);
    use_all_time_fetch_effect(server_url.clone(), user, all_time, loading, error);
    use_in_progress_fetch_effect(server_url.clone(), user, in_progress);

    // Rule 12: hold the page loader until both this reader's all-time summary
    // and the household list (fetched once, in the parent) have answered —
    // a picker that pops in after the rest of the page has already settled
    // reads as content shifting under the reader.
    if loading() || readers.read().is_none() {
        return rsx! { Loading { kind: LoadingKind::Page, label: "Tallying your reading" } };
    }

    let reader_list = readers.read().clone().unwrap_or_default();
    let current = viewing(user, &reader_list);
    let who = current.heading();

    if let Some(failure) = error() {
        return rsx! { StatsFailure { failure, other: who.is_some() } };
    }

    let standing = all_time.read().clone();
    let empty = standing.as_ref().is_none_or(StatsSummary::is_empty);
    let who_name = match &current {
        Viewing::You => None,
        Viewing::Reader { name } => Some(name.clone()),
    };

    rsx! {
        div { class: "st-page",
            StatsHero { summary: standing.clone(), who: who.clone(),
                ReaderPicker { readers: reader_list, selected: user }
            }
            ScopeSwitch { scope }
            div { class: "st-body",
                if empty {
                    StatsEmpty { who_name }
                } else if scope() == Scope::User {
                    UserScope { range, period, all_time, in_progress, expanded }
                } else {
                    LibraryScope { size: library_size(), composition: library_composition() }
                }
                StatsFreshnessNote {}
            }
            if let (Some(metric), Some(summary)) = (expanded(), period.read().clone()) {
                DrillIn { metric, summary, expanded }
            }
        }
    }
}

/// Why the page can't show a reader's figures.
#[derive(Clone, Debug, PartialEq)]
enum Failure {
    /// The server refused another reader's stats: not sharing, or no such
    /// reader.
    NotSharing,
    /// Any other failed read, with its message.
    Other(String),
}

impl From<&DataError> for Failure {
    fn from(e: &DataError) -> Self {
        if data::is_not_sharing(e) {
            Failure::NotSharing
        } else {
            Failure::Other(e.to_string())
        }
    }
}

/// Renders a [`Failure`]. `other` is whether the reader being viewed is
/// someone besides the caller — it decides where "back" goes: another
/// reader's failed page returns to the caller's own `/stats`, the caller's
/// own failed page keeps today's "Back to library".
#[component]
fn StatsFailure(failure: Failure, other: bool) -> Element {
    let back_to_stats = crate::routes::link_target(Route::Stats { user: None });
    match failure {
        Failure::NotSharing => rsx! {
            PageError {
                message: "This reader isn't sharing their stats".to_string(),
                back_to: back_to_stats,
                back_label: "Back to your stats".to_string(),
            }
        },
        Failure::Other(message) if other => rsx! {
            PageError {
                message,
                back_to: back_to_stats,
                back_label: "Back to your stats".to_string(),
            }
        },
        Failure::Other(message) => rsx! {
            PageError { message, back_to: Route::Landing {} }
        },
    }
}

/// The user-scoped stack: the windowed band, then the standing one.
///
/// Split out of [`StatsPage`] so the page component stays a shell — the two
/// bands are the page's actual content and each has its own render gate.
#[component]
fn UserScope(
    range: Signal<StatsRange>,
    period: Signal<Option<StatsSummary>>,
    all_time: Signal<Option<StatsSummary>>,
    in_progress: Signal<Vec<ResumePoint>>,
    expanded: Signal<Option<Metric>>,
) -> Element {
    rsx! {
        div { class: "st-scope", "data-testid": "stats-scope-user",
            WindowBand { range, period, expanded }
            StandingBand { all_time, in_progress }
        }
    }
}

/// Everything the period switcher governs, under one label and one boundary.
/// The pills live in the band's own sticky header — not in the page title —
/// so the control sits immediately above the figures it moves.
#[component]
fn WindowBand(
    range: Signal<StatsRange>,
    period: Signal<Option<StatsSummary>>,
    expanded: Signal<Option<Metric>>,
) -> Element {
    let current = range();
    let guard = period.read();
    let label = guard
        .as_ref()
        .map(|s| window_label(current, &s.as_of_day))
        .unwrap_or_default();
    rsx! {
        section { class: "st-band", "data-testid": "stats-period-section",
            div { class: "st-band-head", "data-testid": "stats-window-head",
                div { class: "st-band-heading",
                    span { class: "st-band-kicker", "In this window" }
                    span { class: "st-band-window", "data-testid": "stats-window-label", {label} }
                }
                div { class: "st-band-rule st-band-rule-accent" }
                div { class: "st-ranges", role: "group", "aria-label": "Period",
                    for r in StatsRange::ALL {
                        button {
                            key: "{r.as_query()}",
                            class: if r == current { "st-range-pill on" } else { "st-range-pill" },
                            r#type: "button",
                            "data-testid": "stats-range-{r.as_query()}",
                            "aria-pressed": if r == current { "true" } else { "false" },
                            onclick: move |_| range.set(r),
                            {r.label()}
                        }
                    }
                }
            }
            WindowContents { period, expanded }
        }
    }
}

/// The windowed modules themselves — a placeholder card until the first
/// period fetch lands.
#[component]
fn WindowContents(
    period: Signal<Option<StatsSummary>>,
    expanded: Signal<Option<Metric>>,
) -> Element {
    let guard = period.read();
    let Some(summary) = guard.as_ref() else {
        return rsx! {
            div { class: "card st-card-placeholder",
                Loading {
                    kind: LoadingKind::Section,
                    testid: "stats-window-loading",
                    label: "Tallying this window",
                }
            }
        };
    };
    rsx! {
        div { class: "st-band-body",
            HeadlineTiles { summary: summary.clone(), expanded }
            div { class: "st-duo",
                ReadingClock { summary: summary.clone() }
                GenreDonut { summary: summary.clone() }
            }
            StandoutsGrid { summary: summary.clone() }
        }
    }
}

/// Everything the switcher does not govern. The absence of the band header's
/// accent rule is the signal: nothing under this label moves when the pills
/// do.
#[component]
fn StandingBand(
    all_time: Signal<Option<StatsSummary>>,
    in_progress: Signal<Vec<ResumePoint>>,
) -> Element {
    let guard = all_time.read();
    let Some(summary) = guard.as_ref() else {
        return rsx! {
            div { class: "card st-card-placeholder",
                Loading {
                    kind: LoadingKind::Section,
                    testid: "stats-standing-loading",
                    label: "Looking back over the year",
                }
            }
        };
    };
    rsx! {
        section { class: "st-band", "data-testid": "stats-alltime-section",
            div { class: "st-band-head st-band-head-plain",
                div { class: "st-band-heading",
                    span { class: "st-band-kicker st-band-kicker-quiet", "Outside the window" }
                }
                div { class: "st-band-rule" }
            }
            div { class: "st-band-body",
                HeatmapCard { summary: summary.clone() }
                div { class: "st-duo",
                    InProgressCard { books: in_progress(), summary: summary.clone() }
                    RecentlyFinishedCard { books: summary.finished_books.clone() }
                }
                MonthlyChart { summary: summary.clone() }
            }
        }
    }
}

/// The library-scoped stack — the shelf's own size and composition, neither of
/// which the period switcher can reach.
#[component]
fn LibraryScope(size: Option<LibrarySize>, composition: Option<LibraryComposition>) -> Element {
    rsx! {
        div { class: "st-scope", "data-testid": "stats-scope-library",
            LibrarySizeHero { size }
            LibraryCompositionPanels { composition }
        }
    }
}

/// The User / Library switch, pinned under the top bar so the reader always
/// knows which scope the figures below belong to.
#[component]
fn ScopeSwitch(scope: Signal<Scope>) -> Element {
    let current = scope();
    rsx! {
        div { class: "st-modes", "data-testid": "stats-scope-switch",
            div { class: "st-modes-inner",
                ScopeTab {
                    name: "User",
                    blurb: "Your reading, this period",
                    testid: "stats-scope-tab-user",
                    on: current == Scope::User,
                    onpick: move |_| scope.set(Scope::User),
                }
                ScopeTab {
                    name: "Library",
                    blurb: "The shelf itself",
                    testid: "stats-scope-tab-library",
                    on: current == Scope::Library,
                    onpick: move |_| scope.set(Scope::Library),
                }
                if current == Scope::Library {
                    span { class: "st-modes-note", "Whole shelf \u{00B7} not period-scoped" }
                }
            }
        }
    }
}

/// One scope tab: its name over the blurb that says what it covers.
#[component]
fn ScopeTab(
    name: &'static str,
    blurb: &'static str,
    testid: &'static str,
    on: bool,
    onpick: EventHandler<()>,
) -> Element {
    rsx! {
        button {
            class: if on { "st-mode on" } else { "st-mode" },
            r#type: "button",
            "data-testid": testid,
            "aria-pressed": if on { "true" } else { "false" },
            onclick: move |_| onpick.call(()),
            span { class: "st-mode-name", {name} }
            span { class: "st-mode-blurb", {blurb} }
        }
    }
}

/// The footer note's text, deriving its number from [`STATS_TTL_SECS`]
/// rather than a second hardcoded copy.
fn freshness_note_text() -> String {
    format!("Stats are accurate to the last ~{STATS_TTL_SECS} seconds.")
}

/// Footer note explaining the aggregate cache's TTL, so a just-made change
/// (e.g. marking a book finished) not yet reflected in the numbers reads as
/// expected staleness rather than a bug.
#[component]
fn StatsFreshnessNote() -> Element {
    rsx! {
        p { class: "st-footnote", "data-testid": "stats-freshness-note",
            {freshness_note_text()}
        }
    }
}

/// Blank this reader's signals and re-show the page loader the instant
/// `user` changes. A plain prop change earns no automatic reactivity in
/// Dioxus — only a *signal* read inside a `use_effect` does — so without this
/// the three fetch effects below would each need to be told the same thing;
/// centralizing it here also means the reset always lands in the same render
/// as the refetches it precedes, before either is aware of the other.
#[allow(clippy::too_many_arguments)]
fn use_reader_switch_reset_effect(
    user: Option<i64>,
    mut period: Signal<Option<StatsSummary>>,
    mut all_time: Signal<Option<StatsSummary>>,
    mut in_progress: Signal<Vec<ResumePoint>>,
    mut loading: Signal<bool>,
    mut error: Signal<Option<Failure>>,
    mut expanded: Signal<Option<Metric>>,
) {
    use_effect(use_reactive!(|user| {
        let _ = user;
        period.set(None);
        all_time.set(None);
        in_progress.set(Vec::new());
        loading.set(true);
        error.set(None);
        expanded.set(None);
    }));
}

/// Refetch the period-scoped summary whenever the switcher changes, or the
/// viewed reader does. The signal read inside the effect subscribes it to
/// `range`; `user` needs the `use_reactive!` wrapper for the same reason
/// [`use_reader_switch_reset_effect`] exists — a plain prop isn't a signal.
///
/// A monotonic `epoch` ticket guards against out-of-order completion: rapid
/// switcher changes fan out concurrent fetches, and a slower earlier request
/// must not overwrite a newer range's data. Only the fetch holding the current
/// ticket applies its result, and a success clears any prior error so a
/// transient failure can't stick the page in the error state.
fn use_period_fetch_effect(
    server_url: String,
    user: Option<i64>,
    range: Signal<StatsRange>,
    period: Signal<Option<StatsSummary>>,
    error: Signal<Option<Failure>>,
) {
    let mut epoch = use_signal(|| 0u64);
    let generation = crate::use_cache_generation();
    use_effect(use_reactive!(|user| {
        let r = range();
        // Re-run on cache-revalidation bumps; the refetch is a cache hit.
        let _ = generation();
        let ticket = *epoch.peek() + 1;
        epoch.set(ticket);
        let url = server_url.clone();
        let mut period = period;
        let mut error = error;
        spawn(async move {
            let result = data::fetch_stats(&url, r, user).await;
            // A newer switcher change superseded this fetch — drop the stale result.
            if *epoch.peek() != ticket {
                return;
            }
            match result {
                Ok(summary) => {
                    period.set(Some(summary));
                    error.set(None);
                }
                Err(e) => error.set(Some(Failure::from(&e))),
            }
        });
    }));
}

/// One-shot fetch of the all-time summary, re-run when the viewed reader
/// does — deliberately not keyed on the switcher, since it feeds the standing
/// hero and the standing band, neither of which a range change may move.
///
/// The goals ride this payload and are rendered straight off it — nothing on
/// this page writes them, so there is no saved answer to fold back in.
fn use_all_time_fetch_effect(
    server_url: String,
    user: Option<i64>,
    all_time: Signal<Option<StatsSummary>>,
    loading: Signal<bool>,
    error: Signal<Option<Failure>>,
) {
    let generation = crate::use_cache_generation();
    use_effect(use_reactive!(|user| {
        // Re-run on cache-revalidation bumps; the refetch is a cache hit.
        let _ = generation();
        let url = server_url.clone();
        let mut all_time = all_time;
        let mut loading = loading;
        let mut error = error;
        spawn(async move {
            match data::fetch_stats(&url, StatsRange::AllTime, user).await {
                Ok(summary) => all_time.set(Some(summary)),
                Err(e) => error.set(Some(Failure::from(&e))),
            }
            loading.set(false);
        });
    }));
}

/// One-shot fetch of the library-scale totals. Never keyed on the switcher —
/// the library's size is not a reporting period's figure — and deliberately
/// silent on failure: this card is context beside the reader's own numbers,
/// and a library-size fetch that fails must not blank the page they came for.
fn use_library_size_fetch_effect(server_url: String, library_size: Signal<Option<LibrarySize>>) {
    let generation = crate::use_cache_generation();
    use_effect(move || {
        // Re-run on cache-revalidation bumps; the refetch is a cache hit.
        let _ = generation();
        let url = server_url.clone();
        let mut library_size = library_size;
        spawn(async move {
            match data::fetch_library_size(&url).await {
                Ok(size) => library_size.set(Some(size)),
                // Settle on the unmeasured value, which renders nothing, so
                // the placeholder never outlives the request.
                Err(_) if library_size.peek().is_none() => {
                    library_size.set(Some(LibrarySize::default()));
                }
                Err(_) => {}
            }
        });
    });
}

/// One-shot fetch of the library composition. Never keyed on the switcher —
/// what the collection is made of is not a reporting period's figure — and
/// silent on failure for the same reason its size sibling is.
fn use_library_composition_fetch_effect(
    server_url: String,
    library_composition: Signal<Option<LibraryComposition>>,
) {
    let generation = crate::use_cache_generation();
    use_effect(move || {
        // Re-run on cache-revalidation bumps; the refetch is a cache hit.
        let _ = generation();
        let url = server_url.clone();
        let mut library_composition = library_composition;
        spawn(async move {
            match data::fetch_library_composition(&url).await {
                Ok(composition) => library_composition.set(Some(composition)),
                // Same settling as the size fetch: empty renders nothing.
                Err(_) if library_composition.peek().is_none() => {
                    library_composition.set(Some(LibraryComposition::default()));
                }
                Err(_) => {}
            }
        });
    });
}

/// One-shot fetch of the books the reader currently has open, re-run when the
/// viewed reader does. Its own read rather than a `StatsSummary` field: what
/// is in progress is a fact about now, and hanging it off the windowed
/// payload would make a period switch appear to change which books are open.
/// Silent on failure, like the two library fetches — the card renders nothing
/// rather than blanking the page.
fn use_in_progress_fetch_effect(
    server_url: String,
    user: Option<i64>,
    in_progress: Signal<Vec<ResumePoint>>,
) {
    let generation = crate::use_cache_generation();
    use_effect(use_reactive!(|user| {
        // Re-run on cache-revalidation bumps; the refetch is a cache hit.
        let _ = generation();
        let url = server_url.clone();
        let mut in_progress = in_progress;
        spawn(async move {
            if let Ok(points) = data::recent_progress(&url, IN_PROGRESS_LIMIT, user).await {
                in_progress.set(points);
            }
        });
    }));
}

/// Fetch the household readers whose stats the caller may view, once per
/// [`StatsPage`] mount (never per-reader — switching whose figures are shown
/// doesn't change who else shares). Silent on failure, like the library
/// fetches beside it: a failed list settles as empty, which hides the picker
/// rather than stalling the page's loader forever.
fn use_household_readers_fetch_effect(
    server_url: String,
    readers: Signal<Option<Vec<HouseholdReader>>>,
) {
    let generation = crate::use_cache_generation();
    use_effect(move || {
        // Re-run on cache-revalidation bumps; the refetch is a cache hit.
        let _ = generation();
        let url = server_url.clone();
        let mut readers = readers;
        spawn(async move {
            match data::household_readers(&url).await {
                Ok(list) => readers.set(Some(list)),
                // Settle on an empty list so the loader clears; a later
                // revalidation failure leaves an already-fetched list alone.
                Err(_) if readers.peek().is_none() => readers.set(Some(Vec::new())),
                Err(_) => {}
            }
        });
    });
}

/// Friendly empty state for a reader with no recorded activity. `who_name`
/// switches the sub-line to third person when it names another reader —
/// `None` on the caller's own page, which keeps today's copy. One stable
/// outer element either way (rule 07): only the sub-line's text changes.
#[component]
fn StatsEmpty(#[props(default)] who_name: Option<String>) -> Element {
    let sub = match &who_name {
        Some(name) => format!("{name} hasn't tracked any reading yet."),
        None => {
            "Open a book or start an audiobook and your stats will begin to fill in.".to_string()
        }
    };
    rsx! {
        div { class: "card st-empty", "data-testid": "stats-empty",
            h3 { class: "st-empty-title", "No reading activity yet" }
            p { class: "st-empty-sub", {sub} }
        }
    }
}

#[cfg(test)]
mod tests;
