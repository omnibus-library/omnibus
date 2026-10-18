# React SPA proof of concept

A throwaway slice of the web client rebuilt as a React SPA, to weigh against the
Dioxus frontend. It talks only to the existing Axum `/api/*` REST surface — the
one iOS and MCP already use — and changes nothing in Rust.

Covers three screens: sign-in (cookie session), the library grid (keyset pages
from `GET /api/ebooks`, thumbnails from `/api/thumbs`), and book detail.

## Layout

| Path | Holds |
|---|---|
| `src/styles/` | `theme.css` (tokens, the four themes, the `.atrium` root) and `base.css` |
| `src/components/<Name>/` | shared building blocks: `<Name>.tsx` beside its `.css`, `.stories.tsx` and `.test.tsx` |
| `src/layouts/` | `RequireAuth` (the session gate) and `AppShell` (top bar + page) |
| `src/pages/<Name>/` | one folder per route, its CSS beside it |
| `src/api.ts` | every REST call, parsed at the boundary with zod |
| `src/testing/` | `AppHarness` (a signed-in session and a router), sample books, the Vitest setup |
| `.ladle/` | the story server's config and the provider every story renders inside |
| `tools/extract-atrium.cjs` | copies Atrium rules into component CSS when a screen is ported |

A component imports its own CSS last, after its dependencies, so shared rules
load before the screens that override them.

## Routes

`src/router.tsx` carries all 28 routes from `frontend/src/routes.rs`, with the
same split: the readers and the player fill the screen, everything else sits
under the top bar, and a guest goes to `/login?next=…` and comes back. Login,
the library, book detail and Not Found are ported; every other route renders
`Unported`, which shows its parsed parameters and names its Dioxus source.

## Styling, copied out of Atrium

Each CSS file holds only the `atrium.css` and `loading.css` rules its markup can
match, copied by `tools/extract-atrium.cjs` — 1,282 of Atrium's 13,178 lines.
The components keep the Dioxus class names, which is what lets the copy apply
unchanged: computed styles and screenshots of all three screens match the
`atrium.css` build exactly.

To port a screen: write its markup with the Dioxus class names, map its class
prefix to its CSS file in the script's `OWNERS`, then run
`node tools/extract-atrium.cjs --write` (it only creates missing files) and
`pnpm exec biome check --write .`.

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

`pnpm exec biome check .`, `pnpm exec tsc --noEmit`, `pnpm exec vitest run`,
`pnpm exec ladle build` and `pnpm exec vite build` are the gates; the
`Frontend JS` workflow runs all five when `frontend-js/` changes.

## Stories and tests

- **Stories:** `pnpm exec ladle serve` opens every shared component's
  `*.stories.tsx`, in the app's own styles and theme, at
  `http://localhost:61000`. A story renders inside `AppHarness`, so components
  that need a session or a router work as they do in the app.
- **Component tests** sit beside each component and use Testing Library in
  jsdom. They assert what a reader sees and can do: roles, labels, text.
- **Pages** are tested through the real route table in `src/router.test.tsx`:
  every page that renders without the API, the layout split, the guest
  redirect and `/logs`. The library, book detail and the sign-in submit call
  the API, so they need a local server behind them first.
- **Every story is also rendered** by `src/stories.test.tsx`, so a story that
  stops rendering fails the suite.

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
- **Types are hand-mirrored.** `src/api.ts` copies `shared/`'s serde shapes;
  generating them from `shared`'s `schemars` feature is the fix before shipping.
- **No SSR.** The first paint is blank until the bundle loads, which undoes the
  server-drawn loaders rule 12 is built on.
- **Not done:** Axum serving `dist/` with an SPA fallback, and REST parity for
  the 142 server functions the Dioxus client calls instead.
