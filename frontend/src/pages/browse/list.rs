//! The list pane of a browser: its head (title, filter, sort, Reading chip),
//! its letter-grouped rows beside the A–Z rail, each row's progress bar, and
//! the hooks that load the reader's progress and pick the row a bare index
//! route previews. The page supplies the rows, their order and how one draws.

use std::collections::HashMap;
use std::future::Future;

use dioxus::prelude::*;
use omnibus_shared::BrowseSort;

use crate::components::loading::RowSkeletons;
use crate::data::DataError;

use super::rail::LetterRail;

/// The reader's progress per row: unknown until its request returns, and
/// unknown for good if it fails — never an empty map, which would claim
/// "read nothing".
#[derive(Clone, PartialEq)]
pub enum ListReading<M> {
    Pending,
    Ready(M),
    Failed,
}

impl<M> ListReading<M> {
    /// The progress, once it has loaded.
    pub fn ready(&self) -> Option<&M> {
        match self {
            Self::Ready(map) => Some(map),
            _ => None,
        }
    }

    /// Whether the request is still out.
    pub fn is_pending(&self) -> bool {
        matches!(self, Self::Pending)
    }
}

/// Which row a bare index route previews before the reader picks one.
#[derive(Clone, Copy, PartialEq)]
pub enum Preview {
    /// The list or the reader's progress is still loading.
    Pending,
    /// The library has no rows.
    Empty,
    /// The list failed to load and there is nothing earlier to show.
    Unavailable,
    Item(i64),
}

/// The visible rows in order, and the same rows bucketed by letter when the
/// sort is by name (else empty).
#[derive(Clone, PartialEq)]
pub struct Groups<T> {
    pub filtered: Vec<T>,
    pub letters: Vec<(char, Vec<T>)>,
}

/// The words and test ids a list wears, so one head and body serve each page.
#[derive(Clone, Copy, PartialEq)]
pub struct ListCopy {
    /// The h1, such as "Authors".
    pub title: &'static str,
    /// The plural in the list's notes, such as "authors".
    pub noun: &'static str,
    /// The test-id prefix: `{testid}-filter`, `{testid}-sort-name`, …
    pub testid: &'static str,
    /// The filter's placeholder text.
    pub filter_placeholder: &'static str,
    /// The filter's accessible name.
    pub filter_label: &'static str,
    /// The name sort's button label, such as "Surname".
    pub name_sort: &'static str,
    /// What the list says when it has no rows at all.
    pub empty: &'static str,
}

/// Fetches the reader's progress per row, keyed by `id`, on mount and on
/// every cache-revalidation bump; a failed refetch keeps the last good answer.
pub fn use_list_reading<T, F, Fut>(
    fetch: F,
    id: fn(&T) -> i64,
) -> Signal<ListReading<HashMap<i64, T>>>
where
    T: 'static,
    F: Fn() -> Fut + 'static,
    Fut: Future<Output = Result<Vec<T>, DataError>> + 'static,
{
    let mut state = use_signal(|| ListReading::Pending);
    let generation = crate::use_cache_generation();
    use_effect(move || {
        let _ = generation();
        let request = fetch();
        spawn(async move {
            match request.await {
                Ok(rows) => state.set(ListReading::Ready(
                    rows.into_iter().map(|r| (id(&r), r)).collect(),
                )),
                Err(_) if state.peek().is_pending() => state.set(ListReading::Failed),
                Err(_) => {}
            }
        });
    });
    state
}

/// Which row the bare index route previews. Waits for the progress too, so
/// the preview never lands on one row and then jumps to the one the reader
/// was reading. A failed refresh keeps the rows it had, so only a first load
/// that fails leaves nothing to preview. `pick` chooses among the rows.
pub fn use_preview<T: 'static, M: 'static>(
    rows: Signal<Vec<T>>,
    loading: Signal<bool>,
    error: Signal<Option<String>>,
    reading: Signal<ListReading<M>>,
    pick: fn(&[T], Option<&M>) -> Option<i64>,
) -> Memo<Preview> {
    use_memo(move || {
        if error.read().is_some() && rows.read().is_empty() {
            return Preview::Unavailable;
        }
        if loading() || reading.read().is_pending() {
            return Preview::Pending;
        }
        pick(&rows.read(), reading.read().ready()).map_or(Preview::Empty, Preview::Item)
    })
}

/// Once the pane's row is on screen (`ready`), scrolls it to the middle of
/// the list's own scroller, so a deep link to a row under W doesn't open on
/// the A's. Only that scroller moves: on a phone the list scrolls with the
/// page, and moving the page would hide the filter.
pub fn use_reveal_current_row(ready: bool) {
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
pub fn ListHead(
    copy: ListCopy,
    total: Option<usize>,
    filter: String,
    sort: BrowseSort,
    reading_count: Option<usize>,
    only_reading: bool,
    on_filter: EventHandler<String>,
    on_sort: EventHandler<BrowseSort>,
    on_only_reading: EventHandler<bool>,
) -> Element {
    let ListCopy {
        title,
        noun,
        testid,
        filter_placeholder,
        filter_label,
        name_sort,
        ..
    } = copy;
    let sorts = [
        (BrowseSort::Name, name_sort, "name"),
        (BrowseSort::BookCount, "Most books", "count"),
        (BrowseSort::Recent, "Recent", "recent"),
    ];
    rsx! {
        header { class: "au-list-head",
            h1 { class: "au-title",
                "{title}"
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
                    placeholder: "{filter_placeholder}",
                    "aria-label": "{filter_label}",
                    value: "{filter}",
                    "data-testid": "{testid}-filter",
                    oninput: move |e| on_filter.call(e.value()),
                }
            }
            div { class: "au-controls",
                div { class: "au-sort", role: "group", "aria-label": "Sort {noun}",
                    for (axis, label, id) in sorts {
                        button {
                            key: "{id}",
                            r#type: "button",
                            class: "au-sort-btn",
                            "aria-pressed": if sort == axis { "true" } else { "false" },
                            "data-testid": "{testid}-sort-{id}",
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
                    "data-testid": "{testid}-reading-filter",
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
pub struct ListView<'a, T> {
    pub copy: ListCopy,
    pub groups: &'a Groups<T>,
    pub sort: BrowseSort,
    /// Rows or the order they need are still loading.
    pub waiting: bool,
    /// The letter of the row in the pane, marked on the rail.
    pub active: Option<char>,
    pub error: Option<String>,
    /// Whether the library has any rows, filtered or not.
    pub any: bool,
}

/// The scrolling list: skeleton rows while waiting, letter groups under the
/// name sort, one flat run under the others, and the A–Z rail beside it.
pub fn list_body<T>(view: ListView<'_, T>, row: impl Fn(&T) -> Element) -> Element {
    let ListView {
        copy,
        groups,
        sort,
        waiting,
        active,
        error,
        any,
    } = view;
    let ListCopy {
        noun,
        testid,
        empty,
        ..
    } = copy;
    let show_rail = sort == BrowseSort::Name && !waiting && !groups.letters.is_empty();
    rsx! {
        div { class: "au-list-body",
            div { class: "au-scroll", "data-testid": "{testid}-list",
                if waiting {
                    RowSkeletons { count: 12, avatar: false }
                } else if let Some(msg) = error.filter(|_| !any) {
                    p { class: "au-list-note error", role: "alert", "Couldn\u{2019}t load {noun}: {msg}" }
                } else if groups.filtered.is_empty() {
                    p { class: "au-list-note subtitle",
                        if any { "No {noun} match." } else { "{empty}" }
                    }
                } else if sort == BrowseSort::Name {
                    for (letter, group) in groups.letters.iter() {
                        section {
                            key: "{letter}",
                            id: "letter-{super::letter_frag(*letter)}",
                            class: "au-group",
                            div { class: "au-group-head",
                                span { "{letter}" }
                                span { "{group.len()}" }
                            }
                            for r in group.iter() {
                                {row(r)}
                            }
                        }
                    }
                } else {
                    div { class: "au-group",
                        for r in groups.filtered.iter() {
                            {row(r)}
                        }
                    }
                }
            }
            if show_rail {
                LetterRail {
                    present: groups.letters.iter().map(|(l, _)| *l).collect::<Vec<_>>(),
                    active,
                    testid,
                }
            }
        }
    }
}

/// A row's progress: finished in its accent, in-progress in a lighter tint of
/// it, as shares of `count` books. A skeleton while pending; blank if it
/// never loads. `progress` is (finished, reading).
pub fn row_bar<M>(
    count: usize,
    progress: Option<(usize, usize)>,
    state: &ListReading<M>,
    testid: &'static str,
) -> Element {
    let (class, data_state) = match state {
        ListReading::Pending => ("au-bar ld-skel", "pending"),
        ListReading::Ready(_) => ("au-bar", "ready"),
        ListReading::Failed => ("au-bar is-unknown", "unknown"),
    };
    let pct = |n: usize| {
        if count == 0 {
            0.0
        } else {
            (n.min(count) as f64 * 100.0 / count as f64).floor()
        }
    };
    let (done, now) = progress.map_or((0.0, 0.0), |(f, r)| (pct(f), pct(r)));
    rsx! {
        span {
            class,
            "aria-hidden": "true",
            "data-testid": testid,
            "data-state": data_state,
            span { class: "au-bar-done", style: "width: {done}%" }
            span { class: "au-bar-now", style: "width: {now}%" }
        }
    }
}
