---
paths: "ui_tests/**"
---
# 04a — Playwright per-surface selectors

Companion to [04-playwright.md](04-playwright.md), which owns the toolchain
and the general conventions. This file is the list of surfaces whose obvious
selector is the wrong one — each entry exists because a spec was written
against markup that had changed, and timed out.

**A book tile is a `listitem` holding a link.** The landing grid tile
(`pages/Library/BookGrid.tsx`) is a `role="listitem"` div (testid
`ebook-tile-<slug>`) around a router link named `Open details for <title>`;
`LibraryPage.bookTile(title)` takes the link. The shelf member tile
(`pages/ShelfDetail/ShelfBooks.tsx`) is the link itself with `role="listitem"`,
so there the name sits on the listitem (`ShelfPage.bookTile`) and
`getByRole("link", …)` matches nothing.

**A shelf page's actions are greyed, not gone.** `/shelves/:id` renders Add
books / Edit shelf / ⋯ for every viewer and marks them `aria-disabled="true"`
when the viewer can't change the shelf, each described by the
`shelf-lock-reason` note that says why. `toBeDisabled()` matches that — and so
does Playwright's actionability check, so a plain `click()` on one waits out
its timeout: assert it's inert with `click({ force: true })`, then that nothing
opened. The suite's admin may change every shelf but a Wishlist, so its own
Wishlist is the only locked shelf it sees; the not-your-shelf lock needs a
second, non-admin reader on a cookie-less context (`shelf_detail.spec.ts`).

**The library picker holds one page, not the library.**
`components/LibraryPicker/` (the Add books modal and the hand-picked
create-shelf body) is server-backed: an empty search box browses keyset pages
of 100 behind a `picker-load-more` button, which also loads as it nears view,
while a typed query goes to FTS5 instead and
returns one server-capped set with **no** cursor. So a book past the first page
is simply not in the DOM: `picker-tile-<uuid>` for an arbitrary book times out
unless the spec searches for it first, which is what a reader does anyway.
`picker-status` reports the server's own count — "2310 books" while browsing,
since paging reaches every one of them, and "Showing 50 of 2310 matches ·
narrow your search" only for a search, where the capped rows are genuinely out
of reach. It carries the picked count only in the review view:
`picker-review-picked` ("Picked (2)") toggles a view of just the picks, and
the host modal's submit button (`add-books-submit`, "Add 2 books") counts them
too. Picks are uuids, so they survive a query change even though the cards
don't. `picker-error` is the
failed-fetch state and is distinct from `picker-empty`.

**Original is an absence, not a face.** The typeface chips are
`reader-typeface-<token>` (`original`, `editorial`, `classic`, `modern`,
`sans`, `mono`), and under the default, Original, the section's
`#__omnibus_font` style element is present but **empty** and
`body.style.fontFamily` is `""` — the reader declares no `font-family` at all
so the publisher's own faces win. So assert on a `p`'s computed `font-family`
inside `#omnibus-viewer iframe` (same-origin, `contentDocument` is reachable),
never on a named face being set somewhere.

**The "Add to shelf" picker's tiles are named by their shelf alone.** A
hand-picked shelf is a `role="checkbox"` button (a plain button in the bulk
bar's picker) labelled by its name, so `getByRole("checkbox", { name, exact:
true })` selects it. The smart shelves a book matches sit apart under
`shelf-picker-automatic` as inert `shelf-picker-auto-<id>` tiles. The picker
opens from the Overview's `bp-add-to-shelf`, and the Overview's Shelves row
draws every held shelf, smart ones included, as a `bp-shelf-<id>` link; a
hand-picked one also has a `Take off <name>` button.

**The book page is four tabs, and only the open one is in the DOM.** Under the
hero, the `Book sections` tablist holds Overview, Reviews, Highlights &
Journal and Files & Details. The tab is local state, not in the URL, so every
load opens on Overview: open the tab (`BookDetailPage.openTab(name)`) before
asserting anything on it — the metadata list (`metaValue`), formats, physical
copies, merge and delete live on Files & Details, saved passages and the
journal on Highlights & Journal. The Overview carries the summary, the genre /
tag / shelf chips, the series fan (a region named `<series> series`) and the
"More by <author>" row (`bp-more-by`, its tiles `bp-more-by-tile`), which
`GET /api/authors/{id}` fills (`BookDetailPage.holdAuthorFetch` holds it; a
held page never idles, so open it with `gotoUnsettled()`). That row draws
nothing while loading or for an author's only book — no loading note, no empty
state — so its two tests for those states are fixmes. Immersive reading is in
the hero's `More actions` menu, not a button of its own.

**A saved passage's locator is a chapter title, not "Chapter N".** Once the
book's structure loads, `highlight-meta` reads `Chapter 12: Inej · <date>`;
until then it falls back to `Section N` off the raw CFI spine step (#2356,
#2463). Both are valid for the same position and which one a spec sees depends
on fetch timing, so match the shape (`/^.+ · .+$/`) rather than either
branch.

**A landing *table* row is not a `button`.** The row (`ebook-row-<slug>`,
`pages/Library/BookTable.tsx`) wraps editable cells, so it has no role of its
own. The navigate affordance is the `link` named `Open details for …` **inside
the row** (`LibraryTableComponent.openBook`), and clicking an editable cell
(`td.ebook-col-<column>`: title, author, …) opens its inline editor rather
than navigating.

**A series stack is not a book tile.** With a viewer's Stack series on
(`POST /api/account/stack-series`, per-user server state, off by
default), the landing grid folds every series of two or more visible books
into one `role="button"` named `"{series}, {n} books"`
(`LibraryPage.seriesStack(label)`) in a listitem with no `ebook-tile-*` testid,
so a `/^ebook-tile-/` count drops by every stacked volume. Opening one deals
out a head card (`SeriesCapComponent`: its `Fold up` button and `Series page →`
link) and the volumes as ordinary `ebook-tile-*` tiles; Escape folds. Because the pref follows the account, a
spec that turns it on must run as the worker reader and set it with
`presetStackSeries(true, "reader")` (`landing_series_stacks.spec.ts`). Stacking
the shared admin would fold volumes out from under `landing.spec.ts`.
The toolbar's `Stack series` toggle (`aria-pressed`) renders only in grid view
(absent, not disabled, in the table) and is `aria-disabled` while its save is
out.

**The landing's continue surface is a fan, not a carousel.** The section is
`continue-stack` (`pages/Library/ResumeStack.tsx`); **every** card in the fan
is `hero-resume-<uuid>`, whichever position it holds, and the front one
additionally carries the `lead` class and the `.lmq-veil` verb. Once the
stack scrolls away, `resume-edge` is the ribbon that brings it back. Three
consequences for a spec:

- **A card's centre is not its own.** The fan overlaps by ~74px at rest, so
  `click()` on a card behind the front one hits its neighbour. Hover
  `.lmq-fan` first (which spreads it) and click the left sliver —
  `click({ position: { x: 12, y: 60 } })`.
- **Bringing a book forward** (`ContinueStackComponent.bringForward`) clicks
  only a card that is not yet lead — clicking the lead card navigates. The
  React fan has no cross-format or Immersive chips yet, so the test that
  asserts them is a fixme.
- **`continue-stack` carries the synced marker**, not the card: with no
  per-card eyebrow, "synced" sits on the front book's byline.

`standalone-island` / `standalone-garden` are reserved for the bring-forward
spec: it needs two books on the stack at once, and `recent_progress` drops
`unread` and `finished`, so a book another spec marks could leave the fan mid-run.

**The add-books review is the edit sheet's form, not a confirm form.** The top
nav's Add books opens the `Add a book` sheet over the library (there is no
`/add-books` route). A successful inspect swaps the picker for the edit sheet's
tabs (`Book information`), fields and cover card over a book that does not
exist yet, so the selectors are `MetadataFormComponent`'s: fields by label in
the Details panel (`Number in series`, not "Book #"), author *chips*, and the
cover card only after `openArtwork()`. The commit is "Add to library", never
`es-done`, and "Choose another file" goes back to the picker. A staged cover
writes nothing, so a spec asserting one records that no
`/api/ebooks/*/cover` request fires. No spec commits a real
upload: the library is shared and a filed book is visible to every other spec.

**The stats page** (period pills, the standing band, goals and household
sharing) is covered in [04e-playwright-stats.md](04e-playwright-stats.md).

**The PDF reader has no ready testid; the text layer is not an element you
click.** `/pdf/:uuid` renders its chrome before the document loads (`pdf-back`, `pdf-fit-*`,
`pdf-highlights`, `pdf-bookmarks`, `pdf-stage`, `pdf-page-host`, `pdf-prev`,
`pdf-next`, `pdf-slider`, `pdf-footer`, `pdf-page-label`) and a `pdf-loading`
overlay; "ready" is that overlay leaving and `pdf-page-label` reading
`Page N of M` — the count is PDF.js's, not the indexed one, so parse it from
the label rather than hard-coding it. PDF.js fills `pdf-page-host` with
`.pr-canvas`, `.pr-hl-layer` (one `.pr-hl[data-color]` div per painted quad),
and `.pr-textlayer` (one absolutely positioned, transparent `span` per text
run). To highlight, drag with `page.mouse` from the left edge of a
`.pr-textlayer span` to its right edge — `click()` on a span selects nothing —
then the epub reader's `.rd-selection-popover` and its `Highlight <color>`
swatches appear. The drawers, note composer and quote panel are the epub
reader's (`reader-highlights-drawer`, `reader-bookmarks-drawer`,
`reader-*-row`, `reader-bookmark-add`, `reader-note-composer`); `Escape` on
the reader root closes them. Every turn POSTs `/api/progress` with
`epub_cfi: "pdf-page:N"`; opening the reader POSTs nothing for position (the
ready report is treated as already saved) but does write read status `reading`
on an unread book. Pre-set `flatland` to `reading` in `beforeAll` (the comic
spec's pattern) or assert that write.

**Settings and Administration are one shell, two routes.** `/settings?section=`
holds the five personal sections (`settings-nav-<slug>`), `/admin?section=`
the eight server ones (`admin-nav-<slug>`); `SettingsPage` and `AdminPage`
share the frame in `SettingsShellPage`. Pre-split slugs redirect, so a spec
opens the new URL (`gotoLegacy` on `BasePage` takes an old one). Three things trip
specs:

- **Under 720px the list and the section never share the screen.** With no
  `?section=` only the sidebar renders; with one, only the section and its
  `settings-back` link. A narrow spec names the section in the URL.
- **A sidebar click over unsaved edits doesn't navigate.** It opens
  `unsaved-confirm`: `SettingsShellPage.keepEditing()` / `discardEdits()`.
- **Preferences has no Save button.** Each switch saves on change and reports
  in `{slug}-status`; hidden formats is a `fieldset` (`getByRole("group")`) of
  `hidden-format-toggle-<fmt>` that POSTs on every change, and All Books shows
  `lib-hidden-formats` only while the viewer hides one.

**The authors and series pages are one layout each**: a list (`authors-list` of
`author-card`, `series-list` of `series-card`) beside a pane. The h1 is the list's
title, the pane's name an h2 (`author-name`, `series-name`); the bare route
previews the reader's latest. Delete author is behind `author-more`.

**The filter bar and what reads its saved filter** (the facets, their menus,
the shelf lens and `/shelves/:id` states) have their own file:
[04c-playwright-filters.md](04c-playwright-filters.md).
