---
paths: "ui_tests/**, frontend/src/components/filter_bar/**, frontend/src/components/filter_bar.rs"
---
# 04c — Playwright: the library filter

Companion to [04a-playwright-surfaces.md](04a-playwright-surfaces.md): the filter
bar (`components/filter_bar`) and the surfaces that read its saved filter.
`ui_tests/playwright/tests/flows/library_filters.spec.ts` is the worked spec; the
shelf cases live in `library_filters_shelves.spec.ts`.

**The bar is one facet per field, each with its own menu.** `lib-filter-bar`
(the group named `Library filters`) holds Shelf, Tag, Genre, Author, Series and
Format, in that order, as `filter-facet-<field>` buttons (`aria-haspopup`,
`aria-expanded`). A facet's accessible name is its label plus, while active,
what it keeps ("Author Alfred Aho +1", "Format not PDF"): assert it with
`toHaveAccessibleName`, since its `textContent` runs the parts together. An
active facet has its own `Clear the <Field> filter` button
(`filter-facet-clear-<field>`), and `Clear all` shows once any clause exists.
A facet opens its modal menu, named `Filter by <field>` (Tab wraps inside it;
every close refocuses the facet), pre-filled with that field's clause: mode
buttons, a searchbox, checkboxes labelled by display label (formats uppercase,
shelves by name, `· owner` on another reader's) and Apply. Values load per
field, and a failed load draws `filter-picker-error` with a retry. Escape needs
focus: its handler is the menu's own keydown.

**One clause per field.** Applying a menu replaces every clause on its field,
so clauses combine only across fields, and a saved view with two on one field
shows the first. `FilterBarComponent.addClause` on an active field ticks its
picks on top of the pre-filled ones; it never adds a second clause.

**A menu must land on screen.** From 721px it hangs below its facet (CSS anchor
positioning), aligns to the facet's end where it would cross the right edge,
and opening a low facet scrolls it up first. At 720px and below the facets are
one scrolling row and a menu is a fixed bottom sheet.
`FilterPickerDialogComponent.insets()` measures the open menu against the
window; `library_filter_menus.spec.ts` checks every menu at 390, 768 and 1440, and on
the shelf page at 768.

**Apply refetches what the surface shows.** `POST /api/rpc/ebooks/page` on All
Books; `/api/rpc/shelves/page` — `{ id, filters, … }` — on a selected shelf and
on `/shelves/:id`, which share the filter the landing saved (per browser
context, in localStorage). The three states a filtered shelf can be in:

- **Landing lens:** `lib-filtered-count` carries the narrowed count (and is
  absent while no filter is on),
  `LibraryPage.noMatchesMessage` (with `clearFiltersButton`) is "nothing
  matches", `lib-page-error` a failed narrowed fetch, and `lib-loading` the
  wait. A failed *full* list under a filter is no page error: the rows answer
  the filter, and only `shelf-add-books` goes inert (`aria-disabled`, titled for
  the failure).
- **`/shelves/:id`:** `shelf-count` is absent after a failed fetch (never `0`),
  `shelf-count-pending` while counting, `shelf-filtered-empty` with a `Clear
  filters` *button* (not a testid) when the filter rules every member out,
  `shelf-refetch-error` on failure.
- **A changed filter is loading, not the last answer.** While the refetch for
  new filters is out, the old filters' empty state, count and error are gone;
  a spec sees that only by holding the request.

**Spec technique.** The filter is context state but a shelf is server state, so
the shelf cases run as the worker reader (`readerLibraryPage`, `readerShelfPage`)
with the hand-picked `filterShelf` only that reader owns.

- A held read is `FilterBarComponent.holdShelfReads(clauses?)`, which parks the
  shelf reads carrying that many clauses (all, when omitted) and returns the
  release. The release drops the routes with `page.unrouteAll({ behavior: "wait"
  })`: a plain `unroute` while a handler is parked throws "Route is already
  handled".
- A state that exists only between two events (a tile re-enabled before it
  leaves) is recorded by a `record*` observer (`recordRemoveButtonStates`) and
  asserted afterwards, never polled for.
- The shelf a spec edits comes from `ownShelf`, whose `created*ShelfIds` set
  deletes it after the test, so the specs that count members never see it.
- The Dioxus mobile build's filter sheet has no Playwright lane: it is
  mobile-only, so its logic is pure functions tested under `--features mobile`.
  The web's phone bottom sheet is a viewport, not a build, and is covered.
