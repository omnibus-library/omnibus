# Architecture

How the pieces fit together. What each module does is documented in the module
itself — its `//!` doc, or a Swift file's header comment — and nowhere else.
Print any directory's map from those docs on demand:

```bash
just modules db/src                 # or frontend/src/pages, omnibus-ios/omnibus, …
```

## Workspace

Cargo workspace with seven crates:

- **`shared/`** (`omnibus-shared`) — every type on the `/api/*` wire, plus
  the other serde types shared across targets and logic the server and its
  clients must agree on (range parsing, text
  folding, sort order, ETags, ISBN normalization) so the two sides cannot
  drift. No Dioxus / axum / sqlx deps.
- **`db/`** (`omnibus-db`) — server-side data layer: SQL migrations, SQLite
  pool init, the normalized query layer, and the indexing pipeline (scanner →
  ebook metadata extraction → atomic per-library upsert). Consumed by both
  `server/` (REST handlers) and `frontend/` (server-function bodies). Holds all
  sqlx / tokio / epub / anyhow dependencies on the server side.
- **`frontend/`** (`omnibus-frontend`) — Dioxus UI + server-function wire layer
  (`rpc/`). Feature-gated:
  - `web` — WASM client build (used by `server/` when `dx serve --platform web`
    builds it for WASM).
  - `mobile` — native Dioxus build; uses `reqwest` against `/api/*` REST routes.
  - `server` — SSR/native build; pulls in `omnibus-db` and compiles
    server-function bodies. The name is hardcoded by the dioxus_fullstack_macro
    and can't be renamed.
- **`server/`** (`omnibus`) — **unified Dioxus fullstack binary**. Built twice
  by `dx serve`: once native (feature `server`) for the axum backend + SSR, once
  WASM (feature `web`) for the hydrated client. Hosts the hand-written `/api/*`
  REST router. Depends directly on `omnibus-db`.
- **`mobile/`** (`omnibus-mobile`) — thin Dioxus Native shell that seeds the
  reactive `ServerUrl` context and launches `omnibus_frontend::App`.
  Android-only: the iOS surface is the native `omnibus-ios/` app.
- **`mcp/`** (`omnibus-mcp`) — MCP tool layer over the `/api/*` REST surface,
  served over stdio (the crate's binary) and hosted at `/mcp` by `server/`
  behind an admin toggle, default off. Depends only on `omnibus-shared` plus
  `rmcp` / `reqwest`. Transports, credentials, and the write policy are
  documented in `mcp/src/lib.rs`.
- **`mock-kobo/`** (`omnibus-mock-kobo`) — a **fake Kobo e-reader** for testing
  wireless sync: speaks the firmware's side of `/kobo/<token>/v1/*` and enforces
  the firmware behaviours behind past Kobo regressions, each a named
  `firmware::Quirk` citing its evidence. `mock-kobo serve` runs one device
  behind a loopback control API (`POST /actions/sync`, `GET /device`,
  `GET /requests`, `PUT /reset`; replies `{status, code, message, details}`),
  keeps a JSON state file, and auto-wires the dev seed admin's device;
  `mock-kobo tui` drives that same device from a terminal UI while serving the
  same API. Dev tooling only — it ships in neither the server binary nor the
  Docker image — and it depends on no `omnibus-*` crate, so its wire types can
  catch a server-side shape change that a shared DTO would hide.

Default `cargo build` / `clippy` covers `server`, `shared`, `frontend` only.
Mobile is excluded via workspace `default-members` because its `mobile` feature
is mutually exclusive with `web`; build it explicitly: `cargo build -p
omnibus-mobile`. `mcp` is likewise excluded (a client binary daily server work
never compiles): `cargo build -p omnibus-mcp`. So is `mock-kobo`: `cargo test
-p omnibus-mock-kobo`.

Beside the workspace:

- **`omnibus-ios/`** — the native SwiftUI client, an Xcode project rather than a
  crate. See [ios.md](ios.md).
- **`ui_tests/playwright/`** — the E2E suite: `tests/flows/` (one spec per user
  flow), `tests/ios_glue/` (the iOS reader glue, driven in Chromium), and the
  page-object layers they use: `pages/`, `components/`, `apiRequests/`,
  `contracts/`, `data/`, `fixtures/` (plus `utils/`). Conventions in
  [rule 04](../.claude/rules/04-playwright.md).
- **`openapi/`** — the REST contract; see [below](#the-rest-contract).
- **`frontend-js/`** — a React client over the REST API, typed from that
  contract.
- **`site/`** — the marketing site; see [below](#site).

## Request flows

**Web (fullstack):** browser → axum serves SSR'd HTML + WASM bundle → hydration
→ signal effects call Dioxus server functions (`#[get]`/`#[post]` in
`frontend/src/rpc/`) at `/api/rpc/*` → same handlers execute server-side against
the SQLite pool via an `axum::Extension<SqlitePool>` layer.

**Mobile:** Dioxus signal/effect → `reqwest` call to `/api/*` (hand-written
handlers in `server/src/backend.rs`) → signal update → re-render. Mobile
deliberately does **not** use the `/api/rpc/*` server functions. Every mobile
read is cache-first (stale-while-revalidate): the local copy is served
instantly, a background revalidation refreshes it and nudges rendered pages via
a generation channel, and known-offline reads never touch the network. User
writes queue to a durable outbox on connectivity failure, and a periodic
background tick keeps the outbox drained and the library replica fresh — see
`frontend/src/offline.rs`.

Most features are therefore served twice — a `/api/*` handler for the mobile and
iOS clients, and a server function for the web — each with its own permission
gate and error mapping. A change to one usually needs the other.

## The REST contract

[`openapi/openapi.json`](../openapi/openapi.json) is the OpenAPI 3.1 contract
for the `/api/*` REST API, and the one place a client reads it from: the iOS
app, the React client, the MCP server and any client in another repo. The Rust
code generates it; nobody writes it by hand.

- **Wire types** live in `shared/` and derive `utoipa::ToSchema` behind its
  `openapi` feature, which only the server turns on.
- **Each handler** declares its path, parameters and responses in a
  `#[utoipa::path]` attribute, and `routes.rs` registers it with
  `utoipa_axum::routes!`, which reads the path from that attribute. The router
  and the document come out of one tree (`backend::rest_routes`), so a route
  can't be served without being documented.
- **`backend::openapi::spec`** adds the overview, security schemes and tags.
  `just openapi-gen` writes the file, and a test fails while the committed
  copy is stale, so CI catches a changed route or wire type.
- **`frontend-js/`** generates its zod schemas, fetchers, TanStack Query hooks
  and MSW handlers from the file with orval, so a wire change becomes a
  TypeScript error there.

Left out: the Dioxus server functions (`/api/rpc/*`), Kobo and OPDS, whose
formats their clients fix. Conventions are in
[rule 13](../.claude/rules/13-openapi.md).

## Auth boundary

`auth::require_auth` gates only `/api/*`, exempting `/api/auth/*` and
`/api/_health`. Every surface outside it authenticates itself, so a new one must
too:

- `/kobo/<token>/v1/*` — Kobo sync, by a per-device token in the path.
- `/api/v3/content/*` and `/api/UserStorage/Metadata` — Kobo Reading Services,
  exempted from the gate and authenticated by the `x-kobo-deviceid` header.
- `/opds/*` — a session, else HTTP Basic.
- `/metrics` — `OMNIBUS_METRICS_TOKEN`; the route does not exist until it is set.
- `/mcp` — a bearer token, gated per request on the admin `mcp_enabled` setting.
- `/api/ebooks/{uuid}/images/signed` — exempted from the gate and authenticated
  by a per-image HMAC link (`backend::ebooks::images`).

## Database

Schema ships as numbered SQL migrations under [db/migrations/](../db/migrations/),
embedded via `sqlx::migrate!` and run on pool init in `omnibus_db::init_db`.
Applied versions are recorded in the `_sqlx_migrations` table. Add new
migrations as `NNNN_description.sql` — never edit an applied file (see
[rule 06](../.claude/rules/06-migrations.md)). All tests use `sqlite::memory:`
for isolation; the migrator runs against them the same as production.

## Invariants that span modules

No single module owns these, so a change to any one surface has to keep them:

- **Effective membership.** Every author / tag / series / genre surface —
  browse indexes, discovery, the palette's list and count, cleanup detection,
  taxonomy orphan sweeps, smart-shelf rules — gates on the same override-aware
  membership (the `effective_*_sql!` macros). A looser rule on one makes them
  disagree: the palette offers an author the index rejects.
- **Attribution.** Every user-facing name (journal author, rating, shelf owner)
  reads `COALESCE(display_name, username)`; `username` stays the login and admin
  identity.
- **Derived-byte caches.** Thumbnails, the KEPUB cache and the export-EPUB cache
  all invalidate on `books.last_modified`, so every metadata or cover write must
  bump it (`touch_book_last_modified`) or all three serve stale bytes.
- **Optional binaries.** Calibre and kepubify degrade rather than fail the
  boot: one startup warning, then conversion is disabled or the download falls
  back to plain EPUB.

## Mobile shell

**Server URL:** the backend base URL is a reactive `ServerUrl(Signal<String>)`
context, seeded at launch from `data::server_url_store` (persisted at
`<data_dir>/server` — `Library/Application Support/omnibus/server` on iOS,
`$HOME/.omnibus/server` on desktop/dev, `Context.getFilesDir()/server` on
Android — plaintext, all builds; the URL isn't secret). Empty on first run → the mobile `ScreenLayout` gate routes to the
unguarded `/connect` route (`pages/server_connect.rs`), which validates
reachability via `data::check_server` (`GET /api/_health`) before persisting
and advancing to `/login`. The login screen shows a connected-to bar with a Back
button to change it. `use_server_url()` returns a `String` snapshot;
`use_server_url_signal()` is the writer accessor.

**Auth:** the bearer-token login flow lives in `frontend/src/data/auth.rs` under
`feature = "mobile"`. `data::mobile_login` / `mobile_register` POST to
`/api/auth/{login,register}` with `client_kind: ios|android|bearer` so the
server returns a bearer token in the JSON body. `data::token_store`
(`frontend/src/data/stores.rs`) keeps the token in a process-local
`OnceLock<RwLock<...>>` and persists it to `<data_dir>/token` with `0o600`
perms, so the user stays signed in across a cold start and is only logged out
when the server rejects the bearer. UI components subscribe to
`data::token_store::subscribe()` (a `tokio::sync::watch` receiver) so a
401-driven `token_store::clear()` reactively redirects to `/login` (the gate
checks the `ServerUrl` context first, redirecting to `/connect` when it's
empty). At-rest protection is the iOS sandbox + Data Protection / Android's
per-app UID sandbox + the `0o600` perms; **TODO**: harden with iOS Keychain /
Android Keystore.

## MCP tool boundary

The tools project the shared wire types rather than returning them whole,
because those types are shaped for the iOS and web clients, which hold the whole
book record anyway. An agent pays for that in context, so the tool boundary —
not `shared/` — is where the payload is re-shaped: `recent_progress` defaults to
the stub (pass `verbosity: "full"` for the old payload) and `get_book` takes an
`include` list so one call answers "tell me about this book for this reader".

Re-shaping is all these do. What the server resolved travels through
untouched — a progress record keeps its `resolved` chapter block, and
`book_progress` projects the **whole** `BookProgress` envelope rather than one
record, because answering with a single format is the failure that endpoint was
widened to end. Audio figures keep the `audio_part` / `audio_part_count` names
for the same reason: they are container marks, not book chapters.

Every tool answers with an object, never a bare list or a nullable: a list
comes back under a named field (`{ "authors": [...] }`) and a maybe-absent
value as a nullable field (`{ "progress": null }`). MCP requires an
`outputSchema` root of `type: "object"`, and strict clients refuse the whole
server over one tool that breaks the rule. rmcp no longer enforces this, so
`every_tool_advertises_an_object_rooted_output_schema` does.

`read_book_image` returns a download URL for an EPUB image's original, for a
person to open rather than the tool layer to call. It is a per-image HMAC-signed
link: 15 minutes, minted by `GET /api/ebooks/{uuid}/images/link` for
download-permitted users and verified by `GET /api/ebooks/{uuid}/images/signed`
without a session, so a leaked URL opens that one image and nothing else. It is
built on the caller's public origin, never the loopback the hosted tools call
through: the configured base URL over stdio, or the `/mcp` request's own origin
when hosted (`AppState::request_origin`).

MCP sessions are separable everywhere: `User-Agent: omnibus-mcp/<ver>` on every
request (logged by the server's request span), and login sends
`client_kind: "bearer"` + `device_name: "omnibus-mcp"` so a dedicated device
row shows in `/api/auth/sessions`.

## site/

The marketing site at <https://omnibus-library.github.io/omnibus/>. Not a crate and
not part of any build — `site/src/` is plain HTML/CSS/JS copied verbatim to the
`gh-pages` branch by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)
on every push to `main` that touches it.

| Path | Role |
|---|---|
| `src/index.html` | Thirteen panels. All copy is real markup, never baked into an image. |
| `src/site.css` | `--pg-*` chrome tokens, dark + sepia directions, and the `body.flow` fallback used below 861x560 and whenever JS is off. |
| `src/app.js` | The panel deck — wheel/key/touch behind one gate, direction toggle, section rail. Progressive: the deck is opt-in, the page reads without it. |
| `src/shots/{dark,sepia}/` | App screenshots, WebP, one directory per colour direction. Stills exported at 2x from the Claude Design "Omnibus" project and re-encoded by [`scripts/site-shots.sh`](../scripts/site-shots.sh) (`… <dir> sepia` writes the sibling set); the PNGs are not committed. `omnibus-reader-quote-card` is the exception: both directions are captures of the live reader, not design stills. |

The design stills are a picture of the *design*, not of what the server
currently renders — they need re-exporting as redesigned surfaces ship under
[#2132](https://github.com/omnibus-library/omnibus/issues/2132). The markup
references the dark set; the direction toggle swaps each `img.shot`'s `src` to
`shots/sepia/` for the names listed in `SEPIA_SHOTS` in `app.js` — a shot absent
from that set keeps its dark render in both directions.
The phone renders carry their device bezel with alpha corners in the image
itself, so `.phone .shot` strips the CSS frame chrome the desktop shots get.

Serve it locally with `python3 -m http.server 8000 --directory site/src`. The
deck engages only above 861x560 — below that, and with JS off, `body.flow`
leaves the panels as ordinary stacked sections, so test both.

## Keeping this current

- **A new module** documents itself in its own `//!` doc
  ([rule 05](../.claude/rules/05-rust-style.md)), or a Swift file in its header
  comment. Nothing is added here.
- **This file** changes only when how the pieces fit together changes: a crate,
  a request flow, or a design decision that spans modules.
