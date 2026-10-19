# React SPA proof of concept

A throwaway slice of the web client rebuilt as a React SPA, to weigh against the
Dioxus frontend. It talks only to the existing Axum `/api/*` REST surface — the
one iOS and MCP already use — and adds a REST route only where a ported screen
has none.

Covers three screens: sign-in (cookie session), the library grid (keyset pages
from `GET /api/ebooks`, thumbnails from `/api/thumbs`), and book detail.

## Layout

| Path | Holds |
|---|---|
| `src/styles/` | `theme.css` (tokens, the four themes, the `.atrium` root) and `base.css` |
| `src/components/<Name>/` | shared building blocks: `<Name>.tsx` beside its `.css` and `.stories.tsx` |
| `src/layouts/` | `RequireAuth` (the session gate) and `AppShell` (top bar + page) |
| `src/pages/<Name>/` | one folder per route, its CSS beside it |
| `src/api.ts` | a barrel over `src/api/*.ts`, one file per resource: every REST call the screens make, mapping wire shapes to the ones they render, and the form schemas |
| `src/api/generated/` | zod schemas, fetchers, TanStack Query hooks and MSW handlers that orval generates from `../openapi/openapi.json`; gitignored, rebuilt by `pnpm run generate` (`pnpm install` runs it too) |
| `src/testing/` | `AppHarness`, parsed and wire-format fixtures, the MSW handlers orval can't generate (`handlers.ts`), the Vitest setup |
| `.storybook/` | Storybook's config, the preview every story renders inside, and MSW's worker |
| `tools/extract-atrium.cjs` | copies Atrium rules into component CSS when a screen is ported |

A component imports its own CSS last, after its dependencies, so shared rules
load before the screens that override them.

## Routes

`src/router.tsx` carries all 30 routes from `frontend/src/routes.rs`, with the
same split: the readers and the player fill the screen, everything else sits
under the top bar, and a guest goes to `/login?next=…` and comes back. Login,
Register, the library, book detail, search results (`/search/:query`) and Not
Found are ported, and the top bar carries the user menu and the ⌘K search
palette. As on Dioxus web, a bare `/search` and the native shell's `/connect`
redirect to the library. Every other route renders `Unported`, which shows its
parsed parameters and names its Dioxus source.
Book detail carries all six stops (home, stats, highlights, journals, files,
more) with the rating, quote cards, journal editor, copies and wishlist, shelf
picker, Send to Kindle, merge and delete. It leaves the alignment modal, the
snapped scroll mode, the genre and tag chip editor, the playback dock and the
check-in overlay to the screens that own them.
A page that throws renders `RouteError` inside the top bar; anything else that
throws (the session gate, the shell, a reader) renders it full-screen.

## Styling, copied out of Atrium

Each CSS file holds only the `atrium.css` and `loading.css` rules its markup can
match, copied by `tools/extract-atrium.cjs` — 6,867 of Atrium's 13,966 lines.
The components keep the Dioxus class names, which is what lets the copy apply
unchanged: computed styles and screenshots of the first three screens match the
`atrium.css` build exactly.

To port a screen: write its markup with the Dioxus class names, map its class
prefix to its CSS file in the script's `OWNERS`, then run
`node tools/extract-atrium.cjs --write` (it only creates missing files) and
`pnpm exec biome check --write .`. The script reads class names from string
literals, so build a class from a template and it won't see it: spell it out,
as `UserAvatar`'s `photoClassName` does. A rule a screen needs in a file that
already exists goes in by hand, as does one whose modifier class (`ok`, `error`)
is on the script's stop list; `--write --force` regenerates every file
unformatted and drops their hand edits.

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
  that keeps what is posted, a Kindle send that answers `pending` and then
  `sent`. Stories for the library, book detail and sign-in run against them, so their `play`
  tests cover loading, empty, failing and success states, and the fixtures are
  typed by the spec.
- **Docs:** every component gets a Docs page in Storybook, built from its
  stories, its TypeScript props and its doc comment.
- **Forms** use react-hook-form with a zod resolver (`CredentialsSchema` on the
  sign-in page), so a form's rules live in the same schema style as the API's.
- **Unit tests** (`pnpm run test:unit`, jsdom) cover the API parsers,
  formatting, `safeNext`, the theme root, the session, and the pure helpers
  behind the screens (`resume`, `password`, `settingsIndex`, book detail's
  `readout`, `identifiers`, `shelves`, `journalEditor` and delete copy, the
  palette's `selection`, the results page's `results`, Register's `refusal`), plus the
  real route table in `src/router.test.tsx`: every unported page, the layout
  split, the guest redirect and the redirects.
- **Coverage:** `pnpm exec vitest run --coverage` covers both projects; CI
  uploads each one's lcov to Codecov under the `frontend-js` flag.

## What it showed

| Step | Dioxus (Rust) | React SPA |
|---|---|---|
| Cold build | 80s server + 50s wasm client | 3s install + 1s `vite build` |
| After a UI file edit | 16s server + 8s wasm, before wasm-bindgen and bundling | Vite hot reload (not timed; dev server ready in 168ms) |
| After a `db/` edit | 17s | unchanged: still a Rust rebuild |
| Shipped JS | wasm bundle (not measured) | 460 KB, 140 KB gzipped |
| Shipped CSS | all of `atrium.css` + `loading.css` | 37 KB, 9 KB gzipped |

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
  the 142 server functions the Dioxus client calls instead.
