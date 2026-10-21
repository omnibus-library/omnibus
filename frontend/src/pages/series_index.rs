//! The series browser: every series in a name-ordered list beside the chosen
//! series' page, laid out as the authors browser is. [`SeriesBrowser`] is
//! drawn by the router layout both `/series` and `/series/:id` render inside,
//! so the list — its scroll, filter and sort — stays put while the reader
//! moves between series; the route only swaps the pane. `/series` itself
//! previews [`order::default_series`] in that pane ([`SeriesIndexPage`]).
//!
//! The list's rows are library-wide; the reader's own progress through each
//! series (the bars, the Reading filter, the Recent sort) is a second,
//! per-reader request, and stays unknown — never zero — until it lands.

use dioxus::prelude::*;
use dioxus_router::{Link, Outlet};
use omnibus_shared::{BrowseSort, SeriesReading, SeriesSummary};

use crate::components::{Loading, LoadingKind};
use crate::{data, index_prefs, use_server_url, Route};

use super::browse::{
    list_body, row_bar, use_list_reading, use_preview, use_reveal_current_row, ListCopy, ListHead,
    ListReading, ListView, Preview,
};
use super::index_shell::{use_index_page_shell, IndexPageState};
use super::SeriesPage;

mod order;

use order::{
    compute_series_groups, default_series, first_letter, ListQuery, ReadingMap, SeriesGroups,
};

/// The reader's progress per series, unknown until it lands.
type ReadingState = ListReading<ReadingMap>;

/// The words and test ids the series list wears.
const COPY: ListCopy = ListCopy {
    title: "Series",
    noun: "series",
    testid: "series",
    filter_placeholder: "Filter by name or author\u{2026}",
    filter_label: "Filter series by name or author",
    name_sort: "A\u{2013}Z",
};

/// `/series`' [`Preview`], shared from the layout with the pane below it.
#[derive(Clone, Copy)]
struct SeriesListContext {
    preview: Memo<Preview>,
}

/// List + pane for both series routes; `routed` is `/series/:id`'s id.
#[component]
pub fn SeriesBrowser(routed: Option<i64>) -> Element {
    let server_url = use_server_url();
    let fetch_url = server_url.clone();
    let IndexPageState {
        items: series,
        loading,
        error,
        mut filter,
        mut sort,
    } = use_index_page_shell(
        move || {
            let url = fetch_url.clone();
            async move { data::list_series(&url).await }
        },
        || index_prefs::load().series_sort,
    );
    let reading = use_list_reading(
        move || {
            let url = server_url.clone();
            async move { data::list_series_reading(&url).await }
        },
        |r: &SeriesReading| r.series_id,
    );
    let mut only_reading = use_signal(|| false);
    let preview = use_preview(series, loading, error, reading, default_series);
    use_context_provider(|| SeriesListContext { preview });
    let shown = routed.or(match preview() {
        Preview::Item(id) => Some(id),
        _ => None,
    });
    let groups = use_series_groups(series, filter, sort, reading, only_reading);
    let reading_count = reading
        .read()
        .ready()
        .map(|m| m.values().filter(|r| r.reading > 0).count());
    // A failed refresh keeps its rows, so only an empty list has no count.
    let have_rows = !series.read().is_empty();
    let total = (!loading() && (have_rows || error.read().is_none())).then(|| series.read().len());
    // Recent orders by progress, so it has no order to show until that lands.
    let rows_pending = loading() || (sort() == BrowseSort::Recent && reading.read().is_pending());
    use_reveal_current_row(shown.is_some() && have_rows && !rows_pending);
    // The layout outlives its routes, so Back to the list (or on to another
    // series) must restore the window itself.
    crate::scroll_restore::use_scroll_restore_on_change(routed);

    rsx! {
        div {
            class: "au-page",
            "data-pane": if routed.is_some() { "series" } else { "index" },
            aside { class: "au-list", "aria-label": "Series",
                ListHead {
                    copy: COPY,
                    total,
                    filter: filter(),
                    sort: sort(),
                    reading_count,
                    only_reading: only_reading(),
                    on_filter: move |v| filter.set(v),
                    on_sort: move |s| {
                        sort.set(s);
                        save_series_sort(s);
                    },
                    on_only_reading: move |on| only_reading.set(on),
                }
                {
                    let state = reading.read();
                    let groups = groups.read();
                    let active = shown
                        .and_then(|id| groups.filtered.iter().find(|s| s.id == id))
                        .map(first_letter);
                    let view = ListView {
                        copy: COPY,
                        groups: &groups,
                        sort: sort(),
                        waiting: rows_pending,
                        active,
                        error: error(),
                        any: have_rows,
                    };
                    list_body(view, |s| series_row(s, RowState {
                        shown: shown == Some(s.id),
                        current: routed == Some(s.id),
                        reading: &state,
                    }))
                }
            }
            section { class: "au-detail", Outlet::<Route> {} }
        }
    }
}

/// The visible rows, in order and grouped, rerun only when an input moves.
fn use_series_groups(
    series: Signal<Vec<SeriesSummary>>,
    filter: Signal<String>,
    sort: Signal<BrowseSort>,
    reading: Signal<ReadingState>,
    only_reading: Signal<bool>,
) -> Memo<SeriesGroups> {
    use_memo(move || {
        let state = reading.read();
        compute_series_groups(
            &series.read(),
            ListQuery {
                text: &filter.read(),
                sort: sort(),
                reading: state.ready(),
                only_reading: only_reading(),
            },
        )
    })
}

/// Persists the reader's sort for the next visit.
fn save_series_sort(sort: BrowseSort) {
    let mut prefs = index_prefs::load();
    prefs.series_sort = sort;
    index_prefs::save(&prefs);
}

/// `/series`' pane: the [`Preview`] series' page, without claiming the route
/// (no page title, no `aria-current` on its row).
#[component]
pub fn SeriesIndexPage() -> Element {
    let SeriesListContext { preview } = use_context::<SeriesListContext>();
    match preview() {
        Preview::Pending => rsx! {
            Loading { kind: LoadingKind::Section, label: "Gathering every series" }
        },
        Preview::Unavailable => rsx! {
            p { class: "au-pane-empty subtitle", "Couldn\u{2019}t load series." }
        },
        Preview::Empty => rsx! {
            p { class: "au-pane-empty subtitle", "No series yet \u{2014} the library is empty." }
        },
        Preview::Item(id) => rsx! { SeriesPage { id, preview: true } },
    }
}

/// How one row relates to the pane and the reader.
#[derive(Clone, Copy)]
struct RowState<'a> {
    shown: bool,
    current: bool,
    reading: &'a ReadingState,
}

/// One series: its name over its author, the reader's progress bar, and the
/// book count.
fn series_row(s: &SeriesSummary, state: RowState<'_>) -> Element {
    let accent = s.accent.as_deref().unwrap_or("var(--accent)");
    let progress = state.reading.ready().and_then(|m| m.get(&s.id));
    let count = s.book_count;
    let label = row_label(s, progress);
    rsx! {
        Link {
            key: "{s.id}",
            to: Route::SeriesDetail { id: s.id },
            class: if state.shown { "au-row se-row is-shown" } else { "au-row se-row" },
            style: "--au-accent: {accent}",
            "aria-current": state.current.then_some("page"),
            "aria-label": "{label}",
            "data-testid": "series-card",
            span { class: "se-row-text",
                span { class: "au-row-name se-row-name", "{s.name}" }
                if let Some(author) = s.primary_author.as_deref() {
                    span { class: "se-row-author", "{author}" }
                }
            }
            {row_bar(count, progress.map(|p| (p.finished, p.reading)), state.reading, "series-row-bar")}
            span { class: "au-row-count", "{count}" }
        }
    }
}

/// The row's accessible name: "Dune, by Frank Herbert, 6 books, 2 finished",
/// each part dropped when unknown or zero.
fn row_label(s: &SeriesSummary, progress: Option<&SeriesReading>) -> String {
    let count = s.book_count;
    let books = if count == 1 { "book" } else { "books" };
    let mut label = s.name.clone();
    if let Some(author) = &s.primary_author {
        label.push_str(&format!(", by {author}"));
    }
    label.push_str(&format!(", {count} {books}"));
    if let Some(p) = progress.filter(|p| p.finished > 0) {
        label.push_str(&format!(", {} finished", p.finished));
    }
    label
}

#[cfg(all(test, feature = "server"))]
mod tests;
