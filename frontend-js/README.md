# React SPA proof of concept

A throwaway slice of the web client rebuilt as a React SPA, to weigh against the
Dioxus frontend. It talks only to the existing Axum `/api/*` REST surface — the
one iOS and MCP already use — and adds a REST route only where a ported screen
has none.

The screens it has ported are listed under [Routes](#routes).

## Layout

| Path | Holds |
|---|---|
| `src/styles/` | `theme.css` (tokens, the four themes, the `.atrium` root) and `base.css` |
| `src/components/<Name>/` | shared building blocks: `<Name>.tsx` beside its `.css` and `.stories.tsx` |
| `src/layouts/` | `RequireAuth` (the session gate), `AppShell` (top bar + page + dock) and `ReaderDock` (the readers' frame, with the dock beneath) |
| `src/playback/` | the audiobook player behind `/listen` and the dock: `PlaybackProvider` (the one `<audio>`, mounted in `RequireAuth` so playback survives navigation), `engine` (a port of the Dioxus `OmnibusAudio`), `boot` (resume rules and the position saver), `sleep` and `loadHls`; sessions and read status go through the readers' `readingSession` and `autoReadStatus` |
| `src/pages/<Name>/` | one folder per route, its CSS beside it |
| `src/api.ts` | a barrel over `src/api/*.ts`, one file per resource: every REST call the screens make, mapping wire shapes to the ones they render, and the form schemas; an api module re-exports a wire type verbatim when the screen uses it unchanged, so pages never import `api/generated/schemas` |
| `src/api/generated/` | zod schemas, fetchers, TanStack Query hooks and MSW handlers that orval generates from `../openapi/openapi.json`; gitignored, rebuilt by `pnpm run generate` (`pnpm install` runs it too) |
| `src/vendor/hls/` | hls.js, a byte copy of `frontend/assets/vendor/hls.min.js`, loaded by `<script>` from a Vite `?url` import when a transcoded book plays, so it stays out of the main bundle |
| `src/vendor/barcode/` | the camera scanner's zxing decoder, its wasm and the glue: byte copies of `frontend/assets/vendor/`, loaded by `<script>` from Vite `?url` imports (the zxing IIFE declares a global that bundling would scope away) |
| `src/vendor/reader/` | the EPUB and PDF reader runtimes (epub.js, PDF.js and the two glue files): byte copies of `frontend/assets/vendor/`, loaded from Vite `?url` imports; `parity.test.ts` fails when a copy drifts |
| `public/` | `vendor/pdfjs-wasm/` and `reader-fonts/`, copied verbatim and kept by name because PDF.js and `reader-fonts.css` build URLs onto their directories |
| `src/testing/` | `AppHarness`, parsed and wire-format fixtures, the MSW handlers orval can't generate (`handlers.ts`, and `adminHandlers.ts` for the admin screens), the Vitest setup |
| `.storybook/` | Storybook's config, the preview every story renders inside, and MSW's worker |
| `tools/extract-atrium.cjs` | copies Atrium rules into component CSS when a screen is ported |

A component imports its own CSS last, after its dependencies, so shared rules
load before the screens that override them.

## Routes

`src/router.tsx` carries all 30 routes from `frontend/src/routes.rs`, with the
same split: the readers and the player fill the screen, everything else sits
under the top bar, and a guest goes to `/login?next=…` and comes back. Login,
Register, the library, book detail (with the metadata editor, `/books/:uuid/edit`),
add books (`/add-books`), check-in (`/check-in`), search results
(`/search/:query`), the authors, series and shelves indexes with their detail
pages (`/authors/:id`, `/series/:id`, `/shelves/:id`), the three readers
(`/read`, `/comic`, `/pdf`), the audiobook player (`/listen/:uuid`, `?file_id`
picks one of a book's files), personal settings (`/settings`), Administration
(`/admin`, `/admin/cleanup/:kind`), stats (`/stats`), the chart builder
(`/stats/chart`) and Not Found are ported, and the top bar carries the user
menu and the ⌘K search palette. The phone layouts (the bottom tab bar and the
native shell's shelves screens) are left out. As on Dioxus web, a bare
`/search` and the native shell's `/connect` redirect to the library.
`/settings` has its five sections (Profile, Preferences, Goals, Devices,
Sign-in & security) picked by `?section=`; an old slug redirects to its new
home and `/account` redirects to it.
Book detail is a hero (the cover on its stage, your stars and the household's,
Continue or Listen, the status and More menus) over four tabs, Overview, Reviews,
Highlights & Journal and Files & Details, whose ribbon bookmark slides under the
open tab and whose panels turn like a page (a View Transition, with a CSS fallback
and no motion under reduced motion). Overview holds the description, editable
genre and tag chips, your reading and the household's time in the book (from
`GET /api/books/{uuid}/household`), and related books. Reviews has your review
(one-tap stars, public text and private notes, a spoiler flag) and a card for each
household reader. Highlights & Journal has quote cards that flip to a shareable
face beside the journal's entries, and Files & Details has each file's name,
size and length with Send to Kindle and Kobo, Export, the sync line, physical
copies and the wishlist, the details with an Add link on each one that is unset,
and the curator's edit, merge and delete. Finishing a book plays a ribbon burst
and shows what is next. The alignment modal and the check-in overlay (the top bar
links to the `/check-in` page instead) are left to the screens that own them.
`/books/:uuid/edit` is a child route of `/books/:uuid`: the book page stays
mounted and the metadata editor rises over it as a sheet, so a deep link, a
refresh and Back all draw both. The sheet's tabs are Details, Artwork and
Identifiers, and Fetch metadata takes their place to list one edition per
provider with a checkbox on each field it would change. Fields are refused as
they are typed, a cover that is picked or fetched is held with the other edits
until Done saves them, and leaving with edits asks inline.
The mini dock sits after the page in the shell and beneath `/read`, `/comic` and
`/pdf` (the `ReaderDock` layout route), never on `/listen`; the `<audio>` lives
above the routes, so playback continues as the reader moves between pages. The
mobile shell's native player is left out.
Add books inspects an EPUB, PDF or
audiobook with upload progress, reviews it on the same form, and files it. A
413 (or a connection the server drops mid-send) reads as "larger than this
server accepts": the cap is the server's `OMNIBUS_MAX_UPLOAD_BYTES`, which no
route reports, so the page cannot refuse a big file before sending it. Check-in
takes an ISBN typed, scanned or found by title, and files a copy or a wishlist
entry; the camera never opens until "Scan a barcode" is pressed.
The readers are lazy chunks that mount the vendored epub.js and PDF.js glue from a
React effect; each saves its position as pages turn and records reading
sessions and read status. The EPUB and PDF readers carry highlights, notes,
quotes and bookmarks, and the EPUB reader adds contents, search, the Aa panel and
cross-format follow. The audiobook mini dock on `/read` waits for the player.
Administration shares `/settings`' frame, `SettingsShell`, which takes its
navigation as data. Its eight sections are Sources, Maintenance, Metadata and
Cleanup under Library; People, Integrations, Health and Logs under Server. A
section with unsaved edits asks before any in-app navigation leaves it. A
reader at `/admin` or the review queue gets one refusal line, with no sidebar
or breadcrumb. The review queue (`/admin/cleanup/:kind`) takes Y, N and Space,
an edited book title and an undo, and tallies the pass. `/logs`,
`/admin/health` and `/settings/cleanup/:kind` redirect to their `/admin`
homes, as on Dioxus.
Stats has the streak hero with its goals, the period pills over the window band
(tiles and their drill-in, reading clock, genre donut, standouts), the standing
band (heatmap, books open and finished, monthly chart), the User / Library
scope, the household reader picker (`?user=`) and the sharing switch. Its
figures format as Rust does (`fixed`, ties to even), so a half rounds as it does
on Dioxus. Its charts are CSS and SVG with no chart library, and goal editing
stays in Settings. The chart builder composes a spec from the closed measure
list and draws it in SVG, with a hover card, a drag-to-zoom brush and a value
tween. Nothing links to it, as on Dioxus. Dioxus reads the chart through a
server function with no REST route, so the React chart builder calls
`POST /api/stats/chart`, which was added for it.
A page that throws renders `RouteError` inside the top bar; anything else that
throws (the session gate, the shell, a reader) renders it full-screen.

## Styling, copied out of Atrium

The book page and the metadata editor sheet are not Atrium copies. Their CSS is
hand-written under prefixes the Dioxus app does not use, so
`tools/extract-atrium.cjs` never files a rule against them: `bp-` for the page
(`BookPage.css` for the stage, hero, tabs and finished card, and one file per tab:
`Overview.css`, `ReviewsTab.css`, `HighlightsJournal.css`, `FilesDetails.css`),
`es-` for the sheet (`EditSheet.css`), and `Toast.css` and `Sheet.css` for the two
shared components. `BookDetail.css` and `BookEdit.css` hold only the rules of the
components both screens kept (the review and journal composers, the export menu,
the cover editor, the add page's form) and are pruned when a class loses its last
user.

Elsewhere, each CSS file holds only the `atrium.css`, `loading.css`, `filter_bar.css`,
`authors.css` and `series.css` rules its markup can match, copied by `tools/extract-atrium.cjs`.
The components keep the Dioxus class names, which is what lets the copy apply
unchanged: when sign-in, the library grid and book detail were first ported,
their computed styles and screenshots matched the `atrium.css` build exactly.

To port a screen: write its markup with the Dioxus class names, map its class
prefix to its CSS file in the script's `OWNERS`, then run
`node tools/extract-atrium.cjs --write` (it only creates missing files) and
`pnpm exec biome check --write .`. The script reads class names from string
literals, so build a class from a template and it won't see it: spell it out,
as `UserAvatar`'s `photoClassName` does. A rule a screen needs in a file that
already exists goes in by hand, as does one whose modifier class (`ok`, `error`)
is on the script's stop list; `--write --force` regenerates every file
unformatted and drops their hand edits. `.add-books-progress` in `AddBooks.css` is
hand-written and React-only: the Dioxus page has no such element.

A screen driven by a vendored glue (the readers) is ported differently. The
glue is a byte copy in `src/vendor/reader/`, loaded by `loadScript` from a
`?url` import; it talks back through `window.__omnibusOn*` hooks declared in
`src/env.d.ts`, listed in the page's `HOOKS` array and installed and removed in
its mount effect. Stories swap in a stand-in from `src/testing/readerGlue.ts`.
A new vendored file goes in `src/vendor/reader/parity.test.ts`; editing
`frontend/assets/vendor/` or `reader-fonts/` runs this project's CI and fails
parity until the copy here changes in the same PR. The audiobook dock mounts in
the EPUB footer's `pill` slot (`Footer` in `ReaderChrome.tsx`). Readers are lazy
chunks, so a tab left open across a redeploy asks for an old chunk hash, which
404s into `RouteError` until a reload.

A CSS file that is pure script output (`Library.css`) can be regenerated after
its markup changes by emptying it (`: > src/pages/Library/Library.css`) and
rerunning `--write`, which recreates only that file.

`index.html` draws a themed "Opening your library" loader inside `#root`, so the
first paint isn't blank while the bundle loads; React replaces it on its first
render. The user menu's version line is `OMNIBUS_VERSION` at build time, or
`dev`.

## Run it

```bash
# 1. A backend on this worktree's port. `dioxus-server` panics at boot unless a
#    public/ dir sits next to the binary, so an API-only run needs an empty one.
cargo build -p omnibus
mkdir -p "$CARGO_TARGET_DIR/debug/public"
IP=127.0.0.1 PORT=3460 OMNIBUS_DEV_SEED_USER=admin:poc-password-2026 \
  EBOOK_LIBRARY_PATH=$PWD/test_data/epubs/generated \
  AUDIOBOOK_LIBRARY_PATH=$PWD/test_data/audiobooks/generated \
  "$CARGO_TARGET_DIR/debug/omnibus"

# 2. The SPA, proxying /api to it.
cd frontend-js && pnpm install
OMNIBUS_PORT=3460 pnpm exec vite --port 3461
```

**Or beside `just serve`.** Its `react` pane (suspended until you start it),
or `just react` in another terminal, waits for this worktree's server and runs
Vite on the port the server pane reserved for it, proxying `/api` there.

**Or let the server serve it.** `pnpm run build` writes `dist/` for `/react/`;
start the server with `OMNIBUS_REACT_DIR=$PWD/frontend-js/dist` and the React
client is at `http://localhost:3460/react/`, beside the Dioxus UI at `/`, on
the same origin and session. Off unless that variable is set.

After `pnpm run generate`, `pnpm exec biome check .`, `pnpm exec tsc --noEmit`,
`pnpm exec vitest run`, `pnpm exec storybook build` and `pnpm exec vite build`
are the gates; the `Frontend JS` workflow runs all of them when `frontend-js/`
or `openapi/openapi.json` changes. The story tests need Chromium: the `.#e2e`
shell provides it.

## Stories and tests

- **Storybook:** `pnpm run storybook` opens every shared component's
  `*.stories.tsx` at `http://localhost:6006`, in the app's own styles. The
  toolbar switches between Atrium's four themes. Each story renders inside
  `AppHarness`; a story sets `parameters.user` or `parameters.path` to change
  who is signed in or where the router is.
- **Component tests are the stories' `play` functions.** Each one drives the
  rendered story (types, clicks) and asserts what a reader sees: roles, labels,
  text. **Run tests** in Storybook's sidebar runs them all and marks each story,
  and a story's Interactions panel replays its steps.
- **Every story is a test,** `play` or not: the `storybook` Vitest project
  renders each one in Chromium, so a story that stops rendering fails. The
  a11y addon checks each story too; it reports without failing, because
  Atrium's muted inks fail colour contrast in six stories (as in the Dioxus app).
- **The API is faked with MSW.** orval generates a handler per documented
  status (`src/api/generated/omnibus.msw.ts`), and `src/testing/handlers.ts`
  adds the ones that need behaviour: paging headers, a password check, a journal
  that keeps what is posted, reviews that merge each patch and sum the stars
  again on every read, a Kindle send that answers `pending` and then
  `sent`. `src/testing/adminHandlers.ts` does the same for the admin screens.
  A story uses the generated handler itself for a one-route read (the library
  folders, the worker feed, the task list, the cleanup counts and queue, the
  health report) and for the cleanup detect route: it takes a function that is
  read on every request, so a story can change the answer between reads, and
  the detect one calls back instead of recording. The cleanup undo handler wraps
  the generated one to record the log ids. Each other write handler records
  what it received, and those over a setting or a list (the settings, accounts,
  sessions, the relay, the keys) serve the new state on the next read; a cleanup
  decision, an undo and a job are only recorded.
  `adminHandlers()` is the default set for the sections. Stories for the ported
  screens run against them, so their `play` tests cover loading, empty, failing
  and success states, and the fixtures are typed by the spec.
- **Docs:** every component gets a Docs page in Storybook, built from its
  stories, its TypeScript props and its doc comment.
- **Forms** use react-hook-form with a zod resolver (`CredentialsSchema` on the
  sign-in page), so a form's rules live in the same schema style as the API's.
- **Unit tests** (`pnpm run test:unit`, jsdom) cover the API parsers,
  formatting (`fixed` included), `safeNext`, the theme root, the session, and
  the pure helpers behind the screens (`resume`, `password`, `settingsIndex`,
  `hiddenFormats`, `goals`, `apiTokens`, `viewPrefs`, `focusTrap`, book
  detail's `readout`, `stats`, `lean`, `identifiers` (the details list included),
  `shelves`, `highlightAnchors`, `quietReaders`, `journalMarkdown`, `rating`,
  `reviews` (a patch applied to your review and the household's list, what a save sends, the composer's seed, spoiler veiling and Read more) and delete copy, the palette's `selection`, the results page's `results`, Register's
  `refusal`, the library's `filters`, `libraryView`, `seriesStacks`,
  `shelfLens`, `sorting` and `bulkMetadata`, the editor's `metadata` (form
  schema, the rules a field is refused by and the override diff), `dirty`,
  `editionFields` and `fetch`, the View Transition helper `viewTransition`, `uploads`,
  check-in's `checkInFlow` and `scan`, the scanner's `scanStatus` and
  `loadScanner`, the discovery pages' `browseOrder`, `bookStates`, `authorsOrder`,
  `authorProgress`, `seriesOrder`, `seriesProgress`, `shelvesIndex`, the shelf rules' `rules`, the picker's
  `picker`, the shelf page's `shelfAccess` and `narrow`, the readers' `pager`,
  `pdfAnchors`, `start`, `relocate`, `typography`, `epubGlue`, `pdfGlue`,
  `readingSession` and `autoReadStatus`, the player's `PlaybackProvider`,
  `engine`, `boot`, `sleep`, `loadHls` and `listenView`, stats' `calendar`,
  `summary`, `picker`, `hero`, `goal`, `clock`, `donut`, `superlatives`,
  `tiles`, `drillIn`, `heatmap`, `readingNow`, `monthly`, `library` and
  `composition`, the chart builder's `chart`, `plot`, `notes`, `zoom` and
  `tween`, the admin screens' `sources`, `recentTasks`,
  `workerLines`, `metadataOrder`, `users`, `smtp`, `integrations`, `health`
  and `logs`, and the cleanup review's `review`, plus the vendored files'
  parity test and the `fileNames` case check), the two stats pages' refusal to
  refetch on window focus (against `msw/node`), plus the real route table in
  `src/router.test.tsx`: the settings redirects, the layout split, the guest
  redirect, the admin refusals and the redirects.
- **Coverage:** `pnpm exec vitest run --coverage` covers both projects; CI
  uploads each one's lcov to Codecov under the `frontend-js` flag.

## What it showed

| Step | Dioxus (Rust) | React SPA |
|---|---|---|
| Cold build | 80s server + 50s wasm client | 3s install + 1s `vite build` |
| After a UI file edit | 16s server + 8s wasm, before wasm-bindgen and bundling | Vite hot reload (not timed; dev server ready in 168ms) |
| After a `db/` edit | 17s | unchanged: still a Rust rebuild |
| Shipped JS | wasm bundle (not measured) | 884 KB, 249 KB gzipped |
| Shipped CSS | all of `atrium.css` + `loading.css` | 170 KB, 32 KB gzipped |

Measured on one 16-core Linux box, dev profile, no sccache.

- **Auth needs no server change.** The proxy keeps `Host` as the dev server's,
  so the CSRF origin check passes and the default `__Host-` cookie works.
- **Types are generated.** orval builds the client from
  `../openapi/openapi.json`, the contract the server generates from its handlers,
  and every response is validated against the generated zod schema. A wire
  change in `shared/` becomes a TypeScript error here once the spec and the
  client are regenerated (`just openapi-gen`, then `pnpm run generate`).
- **No SSR.** The first paint is blank until the bundle loads, which undoes the
  server-drawn loaders rule 12 is built on.
- **Not done:** Axum serving `dist/` with an SPA fallback, and REST parity for
  the 129 server functions the Dioxus client calls instead.
