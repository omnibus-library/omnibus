//! Derives the per-render [`LandingViewState`] snapshot and the
//! [`LandingHandlers`] event-handler bundle from [`super::signals::LandingSignals`]
//! — the "what does this render show, and what does clicking it do" stage
//! between signal wiring ([`super::signals`]) and presentation
//! ([`super::body`]).

use dioxus::prelude::*;
use omnibus_shared::{EbookMetadata, SeriesStack, ShelfSummary, ViewFilters, ViewPrefs};

use super::filtering::apply_filters;
use super::signals::LandingSignals;
use crate::shelf_selection::{self, ShelfSelection};
use crate::view_prefs;

/// Which list feeds the grid/table. A gallery pick overlays browse; browse is
/// the default.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum VisibleSource {
    Shelf,
    Browse,
}

/// Resolve the precedence shelf > browse for this render.
pub(super) fn visible_source(selection: ShelfSelection) -> VisibleSource {
    if matches!(selection, ShelfSelection::Shelf(_)) {
        VisibleSource::Shelf
    } else {
        VisibleSource::Browse
    }
}

/// Section-header title for the current gallery pick. Falls back to a neutral
/// "Shelf" while the shelves list is still loading after a reload directly
/// into a persisted selection.
pub(super) fn section_title(selection: ShelfSelection, shelves: &[ShelfSummary]) -> String {
    match selection {
        ShelfSelection::All => "All Books".to_string(),
        ShelfSelection::Shelf(id) => shelves
            .iter()
            .find(|s| s.id == id)
            .map(|s| s.name.clone())
            .unwrap_or_else(|| "Shelf".to_string()),
    }
}

/// The header count for a gallery pick. The member list is the fresher of the
/// two sources — it refetches with the pick, while the gallery's summary
/// carries a server-side aggregate that goes stale the moment membership
/// changes elsewhere — so it wins once it has loaded, and the summary only
/// stands in while that fetch is still out. `None` when neither has answered.
pub(super) fn shelf_book_count(
    selection: ShelfSelection,
    shelves: &[ShelfSummary],
    members: Option<usize>,
) -> Option<usize> {
    if members.is_some() {
        return members;
    }
    match selection {
        ShelfSelection::Shelf(id) => shelves
            .iter()
            .find(|s| s.id == id)
            .and_then(|s| usize::try_from(s.book_count).ok()),
        ShelfSelection::All => None,
    }
}

/// Whether the pick holds no books at all. A filter that rules every book out
/// is not that: it gets the "clear filters" state instead. A shelf's members
/// load unfiltered, so its emptiness is read off them rather than inferred.
pub(super) fn books_empty(
    source: VisibleSource,
    visible_is_empty: bool,
    shelf_members_empty: bool,
    filters: &ViewFilters,
) -> bool {
    match source {
        VisibleSource::Shelf => shelf_members_empty,
        VisibleSource::Browse => visible_is_empty && filters.is_empty(),
    }
}

// Limitation: a stack links its lead book's `series_id`, which can be stale after an override rename.
/// The shelf lens's rows: members filtered, then stacked client-side when Stack series is on.
pub(super) fn shelf_lens(
    members: &[EbookMetadata],
    filters: &ViewFilters,
    stack: bool,
) -> (Vec<EbookMetadata>, Vec<SeriesStack>) {
    let filtered = apply_filters(members, filters);
    if stack {
        omnibus_shared::stack_books(&filtered)
    } else {
        (filtered, Vec::new())
    }
}

/// Per-render snapshot of the data the markup sub-components consume.
/// Computed by [`derive_view_state`] so the [`super::LandingPage`] body is
/// just composition.
#[cfg_attr(feature = "mobile", allow(dead_code))]
pub(super) struct LandingViewState {
    pub(super) is_loading: bool,
    pub(super) page_error: Option<String>,
    pub(super) lib_err: Option<String>,
    pub(super) path_subtitle: String,
    pub(super) path_missing: bool,
    /// `None` until the list feeding the header has answered.
    pub(super) book_count: Option<usize>,
    /// The count is still coming (draw its placeholder); `false` with no
    /// count means the fetch failed and the header shows none at all.
    pub(super) count_pending: bool,
    /// The "N hidden" receipt beside the browse header count; `None` off the
    /// browse lens or when the viewer hides nothing.
    pub(super) hidden_count: Option<i64>,
    pub(super) visible_books: Vec<EbookMetadata>,
    /// Stacks riding with `visible_books`; empty unless Stack series applies.
    pub(super) visible_stacks: Vec<SeriesStack>,
    pub(super) visible_is_empty: bool,
    pub(super) books_empty: bool,
    pub(super) has_more: bool,
    pub(super) is_loading_more: bool,
    pub(super) section_title: String,
    /// Remount key for the book area: changing it replays the sweep-in
    /// cascade (a fresh subtree restarts its CSS animations).
    pub(super) sweep_key: String,
    /// True when the gallery pick is a shelf — the book area's empty state
    /// says the shelf is empty.
    pub(super) is_shelf: bool,
    /// The selected shelf's member list has answered without error, so the
    /// add-books picker can mark what it already holds.
    pub(super) shelf_members_ready: bool,
}

/// Snapshot every signal the markup needs in one place. Reads are cheap, but
/// doing them inline in `rsx!` would multiply each `prefs()`/`books()` call
/// across the three child components.
pub(super) fn derive_view_state(sigs: &LandingSignals) -> LandingViewState {
    // Browse is already server-ordered + server-filtered; render `books`
    // verbatim. A shelf pick renders its (server-sorted) member list,
    // client-filtered by `shelf_lens`.
    let books_sig = sigs.books;
    let prefs_sig = sigs.prefs;
    let selection_sig = sigs.selection;
    let shelf_books_sig = sigs.shelf_books;
    let stacks_sig = sigs.stacks;
    let stack_on = sigs.stack_series;
    let visible = use_memo(move || {
        match visible_source(selection_sig()) {
            VisibleSource::Shelf => {
                let stack = stack_on();
                let members = shelf_books_sig.read().clone().unwrap_or_default();
                let p = prefs_sig.read();
                shelf_lens(&members, &p.filters, stack)
            }
            // Browse renders the server-ordered page verbatim, with the
            // stacks the server folded into it.
            VisibleSource::Browse => (books_sig(), stacks_sig()),
        }
    });

    let selection = (sigs.selection)();
    let source = visible_source(selection);
    let shelves = sigs.shelves.read();
    let path_value = (sigs.lib_path)();
    let browse_loading = (sigs.loading)();
    // Header count: the total under the active filters and exclusion on
    // browse; the shelf's member count on a gallery pick.
    let book_count = match source {
        VisibleSource::Shelf => shelf_book_count(
            selection,
            &shelves,
            sigs.shelf_books.read().as_ref().map(Vec::len),
        ),
        VisibleSource::Browse => (sigs.total)()
            .map(|t| usize::try_from(t).unwrap_or(0))
            .or_else(|| (!browse_loading).then(|| sigs.books.read().len())),
    };
    let (visible_books, visible_stacks) = visible();
    let visible_is_empty = visible_books.is_empty();
    let shelf_members_empty = sigs
        .shelf_books
        .read()
        .as_ref()
        .is_none_or(|members| members.is_empty());
    let empty_pick = books_empty(
        source,
        visible_is_empty,
        shelf_members_empty,
        &prefs_sig.read().filters,
    );
    let path_subtitle = path_value
        .as_ref()
        .map(|p| super::short_path(p))
        .unwrap_or_default();
    let is_loading = match source {
        // A same-shelf refetch keeps its members on screen.
        VisibleSource::Shelf => (sigs.shelf_loading)() && sigs.shelf_books.read().is_none(),
        _ => browse_loading,
    };
    let page_error = (sigs.error)().or_else(|| match source {
        VisibleSource::Shelf => (sigs.shelf_error)(),
        _ => None,
    });
    // A failed fetch has no count to give: never "0 books" from an empty
    // list, and no placeholder counting for good. Only a known total stands.
    // The active source's own failure: a stale browse error must not hide a
    // shelf's count that loaded fine.
    let failed = match source {
        VisibleSource::Shelf => (sigs.shelf_error)().is_some(),
        _ => (sigs.error)().is_some(),
    };
    let total_known = source == VisibleSource::Browse && (sigs.total)().is_some();
    let book_count = book_count.filter(|_| !failed || total_known);
    let count_pending = book_count.is_none() && !failed;

    LandingViewState {
        is_loading,
        page_error,
        lib_err: (sigs.lib_error)(),
        path_subtitle,
        // A shelf pick isn't the surface for the library-path hint, and only
        // an answered fetch can say the path is unset — not one in flight or
        // one that failed.
        path_missing: path_value.is_none()
            && source != VisibleSource::Shelf
            && !browse_loading
            && (sigs.error)().is_none(),
        book_count,
        count_pending,
        // The exclusion (and so the receipt) applies to All Books only.
        hidden_count: match source {
            VisibleSource::Browse => (sigs.hidden)(),
            _ => None,
        },
        visible_books,
        visible_stacks,
        visible_is_empty,
        books_empty: empty_pick,
        // Keyset pagination is browse-only; its cursor stays warm under a
        // shelf pick, so the source guard keeps load-more off the shelf lens.
        has_more: source == VisibleSource::Browse && (sigs.next_cursor)().is_some(),
        is_loading_more: (sigs.loading_more)(),
        section_title: section_title(selection, &shelves),
        sweep_key: format!("{selection:?}"),
        is_shelf: source == VisibleSource::Shelf,
        shelf_members_ready: source == VisibleSource::Shelf
            && sigs.shelf_books.read().is_some()
            && !(sigs.shelf_loading)()
            && (sigs.shelf_error)().is_none(),
    }
}

/// `EventHandler` bundle dispatched into by the markup sub-components.
/// Built by [`build_handlers`] from the owned signals so the
/// [`super::LandingPage`] body stays a thin composition.
#[cfg_attr(feature = "mobile", allow(dead_code))]
pub(super) struct LandingHandlers {
    pub(super) on_prefs_change_header: EventHandler<ViewPrefs>,
    pub(super) on_prefs_change_content: EventHandler<ViewPrefs>,
    pub(super) on_load_more: EventHandler<()>,
    pub(super) on_clear_filters: EventHandler<()>,
    /// Gallery pick: move the glow, persist the choice, swap the book list.
    pub(super) on_select_shelf: EventHandler<ShelfSelection>,
    /// After a create in the gallery's modal: refetch the shelves list.
    pub(super) on_shelf_created: EventHandler<()>,
}

/// Build the UI-event handlers from the landing signals. `save` is `Copy`
/// because every capture (`prefs`, `lib_path` — both `Signal`) is `Copy`,
/// so each handler can take its own reference to the same persisted-prefs
/// update path without cloning closure state.
pub(super) fn build_handlers(sigs: &LandingSignals) -> LandingHandlers {
    let mut prefs = sigs.prefs;
    let lib_path = sigs.lib_path;
    let mut want_more = sigs.want_more;
    let save = move |new_prefs: ViewPrefs| {
        // A failed page fetch leaves `lib_path` unset; the pointer still names the library the prefs came from.
        if let Some(path) = lib_path.peek().clone().or_else(view_prefs::last_library) {
            view_prefs::save(&path, &new_prefs);
        }
        prefs.set(new_prefs);
    };
    LandingHandlers {
        on_prefs_change_header: EventHandler::new({
            let mut save = save;
            move |next: ViewPrefs| save(next)
        }),
        on_prefs_change_content: EventHandler::new({
            let mut save = save;
            move |next: ViewPrefs| save(next)
        }),
        on_load_more: EventHandler::new(move |_: ()| {
            want_more.with_mut(|n| *n += 1);
        }),
        on_clear_filters: EventHandler::new({
            let mut save = save;
            move |_: ()| {
                let mut next = prefs.peek().clone();
                next.filters = ViewFilters::default();
                save(next);
            }
        }),
        on_select_shelf: EventHandler::new({
            let mut selection = sigs.selection;
            move |sel: ShelfSelection| {
                shelf_selection::save(sel);
                selection.set(sel);
            }
        }),
        on_shelf_created: EventHandler::new({
            let mut tick = sigs.shelves_tick;
            move |_: ()| tick.with_mut(|n| *n += 1)
        }),
    }
}

#[cfg(test)]
mod tests;
