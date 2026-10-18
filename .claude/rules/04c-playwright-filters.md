---
paths: "ui_tests/**, frontend/src/components/filter_bar/**, frontend/src/components/filter_bar.rs"
---
# 04c — Playwright: the library filter

Companion to [04a-playwright-surfaces.md](04a-playwright-surfaces.md): the filter
bar (`components/filter_bar`) and the surfaces that read its saved filter.
`ui_tests/playwright/tests/flows/library_filters.spec.ts` is the worked spec.

**The bar is a popover with lazy value lists.** `lib-filter-bar` (the group
named `Library filters`) holds the chips (`filter-chip-<i>`, removed by
`filter-chip-remove-<i>` or the button named `Remove filter: <chip text>`),
`+ Add filter` and, once a clause exists, `Clear all`. Add opens the modal
`Add filter` dialog (Tab wraps inside it; every close refocuses the button):
field and mode buttons, a searchbox, checkboxes labelled by display label
(formats uppercase, shelves by name, `· owner` on another reader's) and Apply.
Values load per field, and a failed load draws `filter-picker-error` with a
retry. Escape needs focus: its handler is the dialog's own keydown.

**Apply refetches what the surface shows.** `POST /api/rpc/ebooks/page` on All
Books; `/api/rpc/shelves/page` — `{ id, filters, … }` — on a selected shelf and
on `/shelves/:id`, which share the filter the landing saved (per browser
context, in localStorage). The three states a filtered shelf can be in:

- **Landing lens:** `lib-section-title` carries the narrowed count,
  `lib-clear-filters-empty` is "nothing matches", `lib-page-error` a failed
  narrowed fetch, and `lib-loading` the wait. A failed *full* list under a
  filter is no page error: the rows answer the filter, and only `shelf-add-books`
  goes inert (`aria-disabled`, titled for the failure).
- **`/shelves/:id`:** `shelf-count` is absent after a failed fetch (never `0`),
  `shelf-count-pending` while counting, `shelf-filtered-empty` with a `Clear
  filters` *button* (not a testid) when the filter rules every member out,
  `shelf-refetch-error` on failure.
- **A changed filter is loading, not the last answer.** While the refetch for
  new filters is out, the old filters' empty state, count and error are gone;
  a spec sees that only by holding the request.

**Spec technique.** The filter is context state but a shelf is server state, so
the shelf cases run as a reader of their own on a cookie-less context with a
hand-picked shelf only that reader owns.

- Hold a read with a route handler that awaits a gate, then release it with
  `page.unrouteAll({ behavior: "wait" })` — a plain `unroute` while a handler is
  parked throws "Route is already handled".
- A state that exists only between two events (a tile re-enabled before it
  leaves) is recorded by a `MutationObserver` and asserted afterwards, never
  polled for.
- Specs that edit a shelf put it back in `finally` (the others count its members).
- The mobile sheet has no Playwright lane: it is mobile-only, so its logic is
  pure functions tested under `--features mobile`.
