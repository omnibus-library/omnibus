//! The authors browser: every author in a surname-ordered list beside the
//! chosen author's page. [`AuthorsBrowser`] is drawn by the router layout both
//! `/authors` and `/authors/:id` render inside, so the list — its scroll,
//! filter and sort — stays put while the reader moves between authors; the
//! route only swaps the pane. `/authors` itself previews
//! [`order::default_author`] in that pane ([`AuthorsIndexPage`]).
//!
//! The list's rows are library-wide; the reader's own progress through each
//! author (the bars, the Reading filter, the Recent sort) is a second,
//! per-reader request, and stays unknown — never zero — until it lands.

use dioxus::prelude::*;
use dioxus_router::{Link, Outlet};
use omnibus_shared::{AuthorReading, AuthorSummary, BrowseSort};

use crate::components::{Loading, LoadingKind};
use crate::{data, index_prefs, use_server_url, Route};

use super::browse::{
    list_body, row_bar, use_list_reading, use_preview, use_reveal_current_row, ListCopy, ListHead,
    ListReading, ListView, Preview,
};
use super::index_shell::{use_index_page_shell, IndexPageState};
use super::AuthorPage;

mod order;

use order::{
    compute_author_groups, default_author, first_letter, name_parts, AuthorGroups, ListQuery,
    ReadingMap,
};

/// The reader's progress per author, unknown until it lands.
type ReadingState = ListReading<ReadingMap>;

/// The words and test ids the authors list wears.
const COPY: ListCopy = ListCopy {
    title: "Authors",
    noun: "authors",
    testid: "authors",
    filter_placeholder: "Filter by name\u{2026}",
    filter_label: "Filter authors by name",
    name_sort: "Surname",
    empty: "No authors yet \u{2014} the library is empty.",
};

/// What the layout shares with the pane below it: `/authors`' [`Preview`],
/// and the rows and progress, so a delete can drop its author from both.
#[derive(Clone, Copy)]
struct AuthorsListContext {
    preview: Memo<Preview>,
    // Read only by the web-only delete, through `use_forget_author`.
    #[cfg_attr(feature = "mobile", allow(dead_code))]
    authors: Signal<Vec<AuthorSummary>>,
    #[cfg_attr(feature = "mobile", allow(dead_code))]
    reading: Signal<ReadingState>,
}

/// Drops a deleted author from the mounted list and its progress, so neither
/// the row, the preview nor the Reading count outlives the delete. A no-op
/// outside the authors layout.
#[cfg(not(feature = "mobile"))]
pub fn use_forget_author() -> impl FnMut(i64) + Copy {
    let ctx = try_use_context::<AuthorsListContext>();
    move |id| {
        if let Some(mut ctx) = ctx {
            ctx.authors.write().retain(|a| a.id != id);
            if let ReadingState::Ready(map) = &mut *ctx.reading.write() {
                map.remove(&id);
            }
        }
    }
}

/// List + pane for both author routes; `routed` is `/authors/:id`'s id.
#[component]
pub fn AuthorsBrowser(routed: Option<i64>) -> Element {
    let server_url = use_server_url();
    let fetch_url = server_url.clone();
    let IndexPageState {
        items: authors,
        loading,
        error,
        mut filter,
        mut sort,
    } = use_index_page_shell(
        move || {
            let url = fetch_url.clone();
            async move { data::list_authors(&url).await }
        },
        || index_prefs::load().authors_sort,
    );
    let reading = use_list_reading(
        move || {
            let url = server_url.clone();
            async move { data::list_author_reading(&url).await }
        },
        |r: &AuthorReading| r.author_id,
    );
    let mut only_reading = use_signal(|| false);
    let preview = use_preview(authors, loading, error, reading, default_author);
    use_context_provider(|| AuthorsListContext {
        preview,
        authors,
        reading,
    });
    let shown = routed.or(match preview() {
        Preview::Item(id) => Some(id),
        _ => None,
    });
    let groups = use_author_groups(authors, filter, sort, reading, only_reading);
    let reading_count = reading
        .read()
        .ready()
        .map(|m| m.values().filter(|r| r.reading > 0).count());
    // A failed refresh keeps its rows, so only an empty list has no count.
    let have_rows = !authors.read().is_empty();
    let total = (!loading() && (have_rows || error.read().is_none())).then(|| authors.read().len());
    // Recent orders by progress, so it has no order to show until that lands.
    let rows_pending = loading() || (sort() == BrowseSort::Recent && reading.read().is_pending());
    use_reveal_current_row(shown.is_some() && have_rows && !rows_pending);
    // The layout outlives its routes, so Back to the list (or on to another
    // author) must restore the window itself.
    crate::scroll_restore::use_scroll_restore_on_change(routed);

    rsx! {
        div {
            class: "au-page",
            "data-pane": if routed.is_some() { "author" } else { "index" },
            aside { class: "au-list", "aria-label": "Authors",
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
                        save_author_sort(s);
                    },
                    on_only_reading: move |on| only_reading.set(on),
                }
                {
                    let state = reading.read();
                    let groups = groups.read();
                    let active = shown
                        .and_then(|id| groups.filtered.iter().find(|a| a.id == id))
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
                    list_body(view, |a| author_row(a, RowState {
                        shown: shown == Some(a.id),
                        current: routed == Some(a.id),
                        reading: &state,
                    }))
                }
            }
            section { class: "au-detail", Outlet::<Route> {} }
        }
    }
}

/// The visible rows, in order and grouped, rerun only when an input moves.
fn use_author_groups(
    authors: Signal<Vec<AuthorSummary>>,
    filter: Signal<String>,
    sort: Signal<BrowseSort>,
    reading: Signal<ReadingState>,
    only_reading: Signal<bool>,
) -> Memo<AuthorGroups> {
    use_memo(move || {
        let state = reading.read();
        compute_author_groups(
            &authors.read(),
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
fn save_author_sort(sort: BrowseSort) {
    let mut prefs = index_prefs::load();
    prefs.authors_sort = sort;
    index_prefs::save(&prefs);
}

/// `/authors`' pane: the [`Preview`] author's page, without claiming the
/// route (no page title, no `aria-current` on its row).
#[component]
pub fn AuthorsIndexPage() -> Element {
    let AuthorsListContext { preview, .. } = use_context::<AuthorsListContext>();
    match preview() {
        Preview::Pending => rsx! {
            Loading { kind: LoadingKind::Section, label: "Gathering every author" }
        },
        Preview::Unavailable => rsx! {
            p { class: "au-pane-empty subtitle", "Couldn\u{2019}t load authors." }
        },
        Preview::Empty => rsx! {
            p { class: "au-pane-empty subtitle", "No authors yet \u{2014} the library is empty." }
        },
        Preview::Item(id) => rsx! { AuthorPage { id, preview: true } },
    }
}

/// How one row relates to the pane and the reader.
#[derive(Clone, Copy)]
struct RowState<'a> {
    shown: bool,
    current: bool,
    reading: &'a ReadingState,
}

/// One author: surname-first name, the reader's progress bar, book count.
fn author_row(a: &AuthorSummary, state: RowState<'_>) -> Element {
    let (last, rest) = name_parts(a);
    let accent = a.accent.as_deref().unwrap_or("var(--accent)");
    let progress = state.reading.ready().and_then(|m| m.get(&a.id));
    let count = a.book_count;
    let books = if count == 1 { "book" } else { "books" };
    let label = match progress {
        Some(p) if p.finished > 0 => {
            format!("{}, {count} {books}, {} finished", a.name, p.finished)
        }
        _ => format!("{}, {count} {books}", a.name),
    };
    rsx! {
        Link {
            key: "{a.id}",
            to: Route::AuthorDetail { id: a.id },
            class: if state.shown { "au-row is-shown" } else { "au-row" },
            style: "--au-accent: {accent}",
            "aria-current": state.current.then_some("page"),
            "aria-label": "{label}",
            "data-testid": "author-card",
            span { class: "au-row-name",
                span { class: "au-row-last", "{last}" }
                if !rest.is_empty() {
                    span { class: "au-row-rest", ", {rest}" }
                }
            }
            {row_bar(count, progress.map(|p| (p.finished, p.reading)), state.reading, "author-row-bar")}
            span { class: "au-row-count", "{count}" }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
