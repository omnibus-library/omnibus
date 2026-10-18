# React SPA proof of concept

A throwaway slice of the web client rebuilt as a React SPA, to weigh against the
Dioxus frontend. It talks only to the existing Axum `/api/*` REST surface — the
one iOS and MCP already use — and changes nothing in Rust.

Covers three screens: sign-in (cookie session), the library grid (keyset pages
from `GET /api/ebooks`, thumbnails from `/api/thumbs`), and book detail.

## Styling is the Dioxus app's own

`src/main.tsx` imports `frontend/assets/atrium.css` and `loading.css` in place,
not copies, so both clients draw from one stylesheet. The components render the
Dioxus markup and class names (`auth-shell-*`, `atrium-topbar`, `lib-grid` /
`lib-tile`, `cover tpl-plate`, `bdmq-*`) and wear the `.atrium[data-theme]`
wrapper the theme tokens resolve against. Porting a screen means matching its
markup, not restyling it.

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

`pnpm exec vitest run`, `pnpm exec tsc --noEmit`, `pnpm exec biome check .`
and `pnpm exec vite build` are the gates.

## What it showed

| Step | Dioxus (Rust) | React SPA |
|---|---|---|
| Cold build | 80s server + 50s wasm client | 3s install + 1s `vite build` |
| After a UI file edit | 16s server + 8s wasm, before wasm-bindgen and bundling | Vite hot reload (not timed; dev server ready in 168ms) |
| After a `db/` edit | 17s | unchanged: still a Rust rebuild |
| Shipped JS | wasm bundle (not measured) | 448 KB, 137 KB gzipped |
| Shipped CSS | the same `atrium.css` + `loading.css` | 351 KB, 63 KB gzipped |

Measured on one 16-core Linux box, dev profile, no sccache.

- **Auth needs no server change.** The proxy keeps `Host` as the dev server's,
  so the CSRF origin check passes and the default `__Host-` cookie works.
- **Types are hand-mirrored.** `src/api.ts` copies `shared/`'s serde shapes;
  generating them from `shared`'s `schemars` feature is the fix before shipping.
- **No SSR.** The first paint is blank until the bundle loads, which undoes the
  server-drawn loaders rule 12 is built on.
- **Not done:** Axum serving `dist/` with an SPA fallback, and REST parity for
  the 142 server functions the Dioxus client calls instead.
