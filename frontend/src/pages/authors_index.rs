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
use omnibus_shared::{AuthorReading, AuthorSort, AuthorSummary};

use crate::components::loading::RowSkeletons;
use crate::components::{Loading, LoadingKind};
use crate::{data, index_prefs, use_server_url, Route};

use super::index_shell::{use_index_page_shell, IndexPageState};
use super::AuthorPage;

mod order;
mod rail;

use order::{
    compute_author_groups, default_author, first_letter, letter_frag, name_parts, AuthorGroups,
    ListQuery, ReadingMap,
};
use rail::LetterRail;

/// The reader's progress per author: unknown until its request returns, and
/// unknown for good if it fails — never an empty map, which would claim
/// "read nothing".
#[derive(Clone, PartialEq)]
enum ReadingState {
    Pending,
    Ready(ReadingMap),
    Failed,
}

impl ReadingState {
    fn ready(&self) -> Option<&ReadingMap> {
        match self {
            Self::Ready(map) => Some(map),
            _ => None,
        }
    }
}

/// Which author `/authors` previews before the reader picks one.
#[derive(Clone, Copy, PartialEq)]
pub enum Preview {
    /// The list or the reader's progress is still loading.
    Pending,
    /// The library has no authors.
    Empty,
    /// The list failed to load and there is nothing earlier to show.
    Unavailable,
    Author(i64),
}

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
    let reading = use_author_reading(server_url);
    let mut only_reading = use_signal(|| false);
    let preview = use_preview(authors, loading, error, reading);
    use_context_provider(|| AuthorsListContext {
        preview,
        authors,
        reading,
    });
    let shown = routed.or(match preview() {
        Preview::Author(id) => Some(id),
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
    let rows_pending =
        loading() || (sort() == AuthorSort::Recent && *reading.read() == ReadingState::Pending);
    use_reveal_current_row(shown.is_some() && have_rows && !rows_pending);

    rsx! {
        div {
            class: "au-page",
            "data-pane": if routed.is_some() { "author" } else { "index" },
            aside { class: "au-list", "aria-label": "Authors",
                AuthorsListHead {
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
                    list_body(ListView {
                        groups: &groups,
                        sort: sort(),
                        reading: &state,
                        shown,
                        routed,
                        loading: loading(),
                        error: error(),
                        any: !authors.read().is_empty(),
                    })
                }
            }
            section { class: "au-detail", Outlet::<Route> {} }
        }
    }
}

/// Which author `/authors` previews. Waits for the progress too, so the
/// preview never lands on one author and then jumps to the one the reader
/// was reading. A failed refresh keeps the rows it had, so only a first load
/// that fails leaves nothing to preview.
fn use_preview(
    authors: Signal<Vec<AuthorSummary>>,
    loading: Signal<bool>,
    error: Signal<Option<String>>,
    reading: Signal<ReadingState>,
) -> Memo<Preview> {
    use_memo(move || {
        if error.read().is_some() && authors.read().is_empty() {
            return Preview::Unavailable;
        }
        if loading() || *reading.read() == ReadingState::Pending {
            return Preview::Pending;
        }
        default_author(&authors.read(), reading.read().ready())
            .map_or(Preview::Empty, Preview::Author)
    })
}

/// The visible rows, in order and grouped, rerun only when an input moves.
fn use_author_groups(
    authors: Signal<Vec<AuthorSummary>>,
    filter: Signal<String>,
    sort: Signal<AuthorSort>,
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
fn save_author_sort(sort: AuthorSort) {
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
        Preview::Author(id) => rsx! { AuthorPage { id, preview: true } },
    }
}

/// Fetches the reader's progress through each author, on mount and on every
/// cache-revalidation bump; a failed refetch keeps the last good answer.
fn use_author_reading(server_url: String) -> Signal<ReadingState> {
    let mut state = use_signal(|| ReadingState::Pending);
    let generation = crate::use_cache_generation();
    use_effect(move || {
        let _ = generation();
        let url = server_url.clone();
        spawn(async move {
            match data::list_author_reading(&url).await {
                Ok(rows) => state.set(ReadingState::Ready(by_author(rows))),
                Err(_) if *state.peek() == ReadingState::Pending => state.set(ReadingState::Failed),
                Err(_) => {}
            }
        });
    });
    state
}

/// Keys the progress rows by author id.
fn by_author(rows: Vec<AuthorReading>) -> ReadingMap {
    rows.into_iter().map(|r| (r.author_id, r)).collect()
}

/// Once the pane's author has a row on screen (`ready`), scrolls it to the
/// middle of the list's own scroller, so a deep link to someone under W
/// doesn't open on the A's. Only that scroller moves: on a phone the list
/// scrolls with the page, and moving the page would hide the filter.
fn use_reveal_current_row(ready: bool) {
    let mut done = use_signal(|| false);
    use_effect(use_reactive!(|ready| {
        if !ready || *done.peek() {
            return;
        }
        done.set(true);
        let _ = dioxus::document::eval(
            "requestAnimationFrame(() => {
               const row = document.querySelector('.au-row.is-shown');
               const list = row?.closest('.au-scroll');
               if (list && list.scrollHeight > list.clientHeight)
                 list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
             })",
        );
    }));
}

/// Title, filter, sort and the Reading filter above the list.
#[component]
fn AuthorsListHead(
    total: Option<usize>,
    filter: String,
    sort: AuthorSort,
    reading_count: Option<usize>,
    only_reading: bool,
    on_filter: EventHandler<String>,
    on_sort: EventHandler<AuthorSort>,
    on_only_reading: EventHandler<bool>,
) -> Element {
    let sorts = [
        (AuthorSort::Name, "Surname", "authors-sort-name"),
        (AuthorSort::BookCount, "Most books", "authors-sort-count"),
        (AuthorSort::Recent, "Recent", "authors-sort-recent"),
    ];
    rsx! {
        header { class: "au-list-head",
            h1 { class: "au-title",
                "Authors"
                span { class: "au-title-count",
                    if let Some(n) = total {
                        "{n}"
                    }
                }
            }
            label { class: "au-search",
                svg {
                    class: "au-search-icon",
                    view_box: "0 0 16 16",
                    "aria-hidden": "true",
                    circle { cx: "7", cy: "7", r: "4.75" }
                    path { d: "M10.5 10.5 14 14" }
                }
                input {
                    r#type: "search",
                    placeholder: "Filter by name\u{2026}",
                    "aria-label": "Filter authors by name",
                    value: "{filter}",
                    "data-testid": "authors-filter",
                    oninput: move |e| on_filter.call(e.value()),
                }
            }
            div { class: "au-controls",
                div { class: "au-sort", role: "group", "aria-label": "Sort authors",
                    for (axis, label, testid) in sorts {
                        button {
                            key: "{testid}",
                            r#type: "button",
                            class: "au-sort-btn",
                            "aria-pressed": if sort == axis { "true" } else { "false" },
                            "data-testid": testid,
                            onclick: move |_| on_sort.call(axis),
                            "{label}"
                        }
                    }
                }
                button {
                    r#type: "button",
                    class: "au-chip",
                    "aria-pressed": if only_reading { "true" } else { "false" },
                    "aria-busy": if reading_count.is_none() { "true" } else { "false" },
                    disabled: reading_count.is_none(),
                    "data-testid": "authors-reading-filter",
                    onclick: move |_| on_only_reading.call(!only_reading),
                    span { class: if reading_count.is_none() { "ld-sheen" } else { "au-chip-label" }, "Reading" }
                    span { class: "au-chip-count",
                        if let Some(n) = reading_count {
                            "{n}"
                        }
                    }
                }
            }
        }
    }
}

/// What [`list_body`] draws from, bundled to keep its signature short.
struct ListView<'a> {
    groups: &'a AuthorGroups,
    sort: AuthorSort,
    reading: &'a ReadingState,
    /// The author in the pane: the route's, or `/authors`' preview.
    shown: Option<i64>,
    /// The route's author alone — the row `aria-current` belongs to.
    routed: Option<i64>,
    loading: bool,
    error: Option<String>,
    any: bool,
}

/// The scrolling list: skeleton rows while loading, letter groups under the
/// surname sort, one flat run under the others, and the A–Z rail beside it.
fn list_body(view: ListView<'_>) -> Element {
    let ListView {
        groups,
        sort,
        reading,
        shown,
        routed,
        loading,
        error,
        any,
    } = view;
    // Recent orders by progress, so it has no order to show until that lands.
    let waiting = loading || (sort == AuthorSort::Recent && *reading == ReadingState::Pending);
    let row = |a: &AuthorSummary| {
        author_row(
            a,
            RowState {
                shown: shown == Some(a.id),
                current: routed == Some(a.id),
                reading,
            },
        )
    };
    let active = shown
        .and_then(|id| groups.filtered.iter().find(|a| a.id == id))
        .map(first_letter);
    let show_rail = sort == AuthorSort::Name && !waiting && !groups.letters.is_empty();
    rsx! {
        div { class: "au-list-body",
            div { class: "au-scroll", "data-testid": "authors-list",
                if waiting {
                    RowSkeletons { count: 12, avatar: false }
                } else if let Some(msg) = error.filter(|_| !any) {
                    p { class: "au-list-note error", role: "alert", "Couldn\u{2019}t load authors: {msg}" }
                } else if groups.filtered.is_empty() {
                    p { class: "au-list-note subtitle",
                        if any { "No authors match." } else { "No authors yet \u{2014} the library is empty." }
                    }
                } else if sort == AuthorSort::Name {
                    for (letter, group) in groups.letters.iter() {
                        section {
                            key: "{letter}",
                            id: "letter-{letter_frag(*letter)}",
                            class: "au-group",
                            div { class: "au-group-head",
                                span { "{letter}" }
                                span { "{group.len()}" }
                            }
                            for a in group.iter() {
                                {row(a)}
                            }
                        }
                    }
                } else {
                    div { class: "au-group",
                        for a in groups.filtered.iter() {
                            {row(a)}
                        }
                    }
                }
            }
            if show_rail {
                LetterRail {
                    present: groups.letters.iter().map(|(l, _)| *l).collect::<Vec<_>>(),
                    active,
                }
            }
        }
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
            {row_bar(count, progress, state.reading)}
            span { class: "au-row-count", "{count}" }
        }
    }
}

/// The row's progress: finished in the author's accent, in-progress in a
/// lighter tint of it. A skeleton while pending; blank if it never loads.
fn row_bar(count: usize, progress: Option<&AuthorReading>, state: &ReadingState) -> Element {
    let (class, data_state) = match state {
        ReadingState::Pending => ("au-bar ld-skel", "pending"),
        ReadingState::Ready(_) => ("au-bar", "ready"),
        ReadingState::Failed => ("au-bar is-unknown", "unknown"),
    };
    let pct = |n: usize| {
        if count == 0 {
            0.0
        } else {
            (n.min(count) as f64 * 100.0 / count as f64).floor()
        }
    };
    let (done, now) = progress.map_or((0.0, 0.0), |p| (pct(p.finished), pct(p.reading)));
    rsx! {
        span {
            class,
            "aria-hidden": "true",
            "data-testid": "author-row-bar",
            "data-state": data_state,
            span { class: "au-bar-done", style: "width: {done}%" }
            span { class: "au-bar-now", style: "width: {now}%" }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
