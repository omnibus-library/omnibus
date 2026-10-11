//! The web shelf page's filter: the library filter the landing page saved, the
//! shelves its chips name, and the member list the server narrows by it. The
//! page's full member list stays the add-books picker's membership, so a
//! filtered-out member still reads as on the shelf.

use dioxus::prelude::*;
use omnibus_shared::{EbookMetadata, SortKey, ViewFilters};

use super::default_dir_for;
use crate::components::ShelfList;
use crate::{data, view_prefs};

/// The page's full member list and how far its fetch has got.
pub(super) struct FullList<'a> {
    pub books: &'a [EbookMetadata],
    /// A fetch has succeeded for the shelf on screen.
    pub ready: bool,
    pub errored: bool,
}

/// The server's narrowed answer and how far its fetch has got.
pub(super) struct NarrowedList<'a> {
    /// `None` until a narrowed fetch has answered.
    pub books: Option<&'a [EbookMetadata]>,
    pub failed: bool,
    /// The answer was fetched under the filters now set. A kept one fetched
    /// under others is neither rows nor a failure to report for these.
    pub current: bool,
}

/// What the member section draws, and which message an empty one gets.
#[derive(Debug, PartialEq)]
pub(super) struct Rows {
    pub books: Vec<EbookMetadata>,
    /// The list the rows come from has not answered yet.
    pub pending: bool,
    pub errored: bool,
    /// The shelf holds books but the filter rules every one out.
    pub filtered_out: bool,
    /// The rows are the empty placeholder of a failed fetch, so their length
    /// is no count of anything.
    pub unavailable: bool,
}

/// Choose the list to draw. Under a filter that is the server's narrowed answer
/// and nothing else: the full list on hand is not a stand-in while it is out.
pub(super) fn rows(filtered: bool, full: FullList<'_>, narrowed: NarrowedList<'_>) -> Rows {
    if !filtered {
        return Rows {
            books: full.books.to_vec(),
            // A refetch keeps the books on screen; only a list never answered is unknown.
            pending: !full.ready && full.books.is_empty() && !full.errored,
            errored: full.errored,
            filtered_out: false,
            unavailable: full.errored,
        };
    }
    let answer = narrowed.books.filter(|_| narrowed.current);
    let narrowed_failed = narrowed.failed && narrowed.current;
    let books = answer.unwrap_or_default().to_vec();
    let pending = answer.is_none();
    let shelf_is_empty = full.ready && full.books.is_empty();
    Rows {
        filtered_out: !pending && !narrowed_failed && books.is_empty() && !shelf_is_empty,
        books,
        pending,
        errored: full.errored || narrowed_failed,
        unavailable: narrowed_failed,
    }
}

/// The signals the narrowed fetch drives.
#[derive(Clone, Copy)]
struct NarrowedSignals {
    books: Signal<Option<Vec<EbookMetadata>>>,
    failed: Signal<bool>,
    /// The filters `books` was fetched under; the list lags the filters by one fetch.
    fetched_under: Signal<ViewFilters>,
}

/// The page's filter state. `Copy` (Dioxus signals), so it travels as one value.
#[derive(Clone, Copy)]
pub(super) struct Narrowing {
    pub filters: Signal<ViewFilters>,
    pub shelves: Signal<ShelfList>,
    narrowed: NarrowedSignals,
}

impl Narrowing {
    /// Apply an edit from the filter bar and file it where the landing page
    /// reads it. With no library browsed yet there is nowhere to file it, so
    /// the filter lives in memory for this visit.
    pub(super) fn set_filters(mut self, next: ViewFilters) {
        view_prefs::save_filters(&next);
        self.filters.set(next);
    }

    /// The rows to draw given the page's full member list.
    pub(super) fn rows(self, full: FullList<'_>) -> Rows {
        let wanted = self.filters.read();
        rows(
            !wanted.is_empty(),
            full,
            NarrowedList {
                books: self.narrowed.books.read().as_deref(),
                failed: (self.narrowed.failed)(),
                current: *self.narrowed.fetched_under.read() == *wanted,
            },
        )
    }
}

/// Wire the page's filter: restore the saved one after mount, list the viewer's
/// shelves for the chips, and refetch the narrowed members when the shelf, the
/// sort, the filter or a membership edit changes.
pub(super) fn use_narrowing(
    shelf_id: i64,
    server_url: String,
    sort_key: Signal<SortKey>,
    reload: Signal<u32>,
) -> Narrowing {
    let mut filters = use_signal(ViewFilters::default);
    let mut shelves = use_signal(|| ShelfList::Pending);

    // Post-mount, so SSR and the first WASM paint both start unfiltered (rule
    // 07). It reads nothing reactive, so it runs once.
    use_effect(move || {
        if let Some(saved) = view_prefs::load_last() {
            if saved.filters != *filters.peek() {
                filters.set(saved.filters);
            }
        }
    });

    let list_url = server_url.clone();
    use_effect(move || {
        let url = list_url.clone();
        spawn(async move {
            shelves.set(match data::list_shelves(&url).await {
                Ok(list) => ShelfList::Loaded(list),
                Err(_) => ShelfList::Failed,
            });
        });
    });

    let narrowed = use_narrowed_members((shelf_id, server_url), filters, sort_key, reload);
    Narrowing {
        filters,
        shelves,
        narrowed,
    }
}

/// The members matching `filters`, fetched from the server whenever the shelf,
/// sort, filter or a membership edit changes; `None` while no filter applies or
/// the answer is out.
fn use_narrowed_members(
    (shelf_id, server_url): (i64, String),
    filters: Signal<ViewFilters>,
    sort_key: Signal<SortKey>,
    reload: Signal<u32>,
) -> NarrowedSignals {
    let mut narrowed = use_signal(|| None::<Vec<EbookMetadata>>);
    let mut failed = use_signal(|| false);
    let mut fetched_under = use_signal(ViewFilters::default);
    let mut epoch = use_signal(|| 0u32);
    let mut narrowed_for = use_signal(|| None::<i64>);
    let generation = crate::use_cache_generation();

    use_effect(use_reactive!(|shelf_id| {
        let key = sort_key();
        let wanted = filters();
        let _ = (reload(), generation());
        let this_fetch = {
            epoch.with_mut(|e| *e += 1);
            *epoch.peek()
        };
        if wanted.is_empty() {
            narrowed_for.set(None);
            narrowed.set(None);
            failed.set(false);
            return;
        }
        // Another shelf's narrowed rows must not paint under this one.
        if *narrowed_for.peek() != Some(shelf_id) {
            narrowed_for.set(Some(shelf_id));
            narrowed.set(None);
        }
        // The last answer's failure belongs to the filters it was fetched under.
        if *fetched_under.peek() != wanted {
            failed.set(false);
        }
        let url = server_url.clone();
        spawn(async move {
            let result =
                data::shelf_page(&url, shelf_id, key, default_dir_for(key), wanted.clone()).await;
            if *epoch.peek() != this_fetch {
                return;
            }
            match result {
                Ok(page) => {
                    narrowed.set(Some(page.books));
                    failed.set(false);
                }
                Err(_) => {
                    narrowed.set(Some(Vec::new()));
                    failed.set(true);
                }
            }
            fetched_under.set(wanted);
        });
    }));
    NarrowedSignals {
        books: narrowed,
        failed,
        fetched_under,
    }
}

#[cfg(test)]
mod tests;
