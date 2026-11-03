# Architecture

How the pieces fit together. What each module does is documented in the module
itself — its `//!` doc, or a Swift file's header comment — and nowhere else.
Print any directory's map from those docs on demand:

```bash
just modules db/src                 # or server/src/backend, omnibus-ios/omnibus, …
```

## Workspace

Cargo workspace with five crates:

- **`shared/`** (`omnibus-shared`) — every type on the `/api/*` wire, plus
  the other serde types shared across targets and logic the server and its
  clients must agree on (range parsing, text
  folding, sort order, ETags, ISBN normalization) so the two sides cannot
  drift. No axum / sqlx deps.
- **`db/`** (`omnibus-db`) — server-side data layer: SQL migrations, SQLite
  pool init, the normalized query layer, and the indexing pipeline (scanner →
  ebook metadata extraction → atomic per-library upsert). Consumed by
  `server/` (REST handlers). Holds all sqlx / tokio / epub / anyhow
  dependencies on the server side.
- **`server/`** (`omnibus`) — the axum binary: the `/api/*` REST router, Kobo,
  KOReader and kosync, OPDS, `/metrics`, the hosted `/mcp` endpoint, and the
  web client's build served at `/`. Depends directly on `omnibus-db`.
- **`mcp/`** (`omnibus-mcp`) — MCP tool layer over the `/api/*` REST surface,
  served over stdio (the crate's binary) and hosted at `/mcp` by `server/`
  behind an admin toggle, default off. Depends only on `omnibus-shared` plus
  `rmcp` / `reqwest`. Transports, credentials, and the write policy are
  documented in `mcp/src/lib.rs`.
- **`mock-kobo/`** (`omnibus-mock-kobo`) — a **fake Kobo e-reader** for testing
  wireless sync: speaks the firmware's side of `/kobo/<token>/v1/*` and enforces
  the firmware behaviours behind past Kobo regressions, each a named
  `firmware::Quirk` citing its evidence. `mock-kobo serve` runs one device
  behind a loopback control API (`POST /actions/{sync,download,remove-download,
  read,finish,highlight,delete-highlight,read-to,highlight-words}`, `GET /device`,
  `GET /requests`, `PUT /reset`; replies
  `{status, code, message, details}`), keeps a JSON state file, and
  auto-wires the dev seed admin's device;
  `mock-kobo tui` drives that same device from a terminal UI while serving the
  same API. Dev tooling only — it ships in neither the server binary nor the
  Docker image — and it depends on no `omnibus-*` crate, so its wire types can
  catch a server-side shape change that a shared DTO would hide.

Default `cargo build` / `clippy` covers `server` and `shared` (and `db` through
`server`). `mcp` is excluded via workspace `default-members` (a client binary
daily server work never compiles): `cargo build -p omnibus-mcp`. So is
`mock-kobo`: `cargo test -p omnibus-mock-kobo`.

Beside the workspace:

- **`omnibus-ios/`** — the native SwiftUI client, an Xcode project rather than a
  crate. See [ios.md](ios.md).
- **`ui_tests/playwright/`** — the E2E suite: `tests/flows/` (one spec per user
  flow), `tests/ios_glue/` (the iOS reader glue, driven in Chromium), and the
  page-object layers they use: `pages/`, `components/`, `apiRequests/`,
  `contracts/`, `data/`, `fixtures/` (plus `utils/`). Conventions in
  [rule 04](../.claude/rules/04-playwright.md).
- **`openapi/`** — the REST contract; see [below](#the-rest-contract).
- **`frontend-js/`** — the web client: a React SPA over the REST API, typed
  from that contract.
- **`site/`** — the marketing site; see [below](#site).

## Request flows

**Web:** browser → axum serves the React build from `OMNIBUS_REACT_DIR` as the
router's fallback (`backend::react_ui`; a deep link gets `index.html`) → the
client calls `/api/*` through the fetchers and TanStack Query hooks generated
from the contract, authenticated by the session cookie. Unset
`OMNIBUS_REACT_DIR`, the API still answers and `/` is a 503.

**iOS:** the native app calls the same `/api/*` routes with a bearer token, and
keeps its own offline store and outbox — see [ios.md](ios.md).

Every client — web, iOS, MCP — speaks that one REST surface, so a feature has
one handler, one permission gate and one error mapping.

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

Left out: Kobo, KOReader (its plugin and its
built-in `/kosync` progress sync) and OPDS, whose formats their clients fix. Conventions are in
[rule 13](../.claude/rules/13-openapi.md).

## Auth boundary

`auth::require_auth` gates only `/api/*`, exempting `/api/auth/*` and
`/api/_health`. Every surface outside it authenticates itself, so a new one must
too:

- `/kobo/<token>/v1/*` — Kobo sync, by a per-device token in the path.
- `/koreader/v1/*` — KOReader plugin, by a per-device token in
  `Authorization: Bearer`.
- `/kosync/*` — stock KOReader's Progress sync, by `x-auth-user` and an
  `x-auth-key` that is the MD5 of a password generated in Settings. Failed
  checks are rate-limited per IP; a correct key never is.
- `/api/v3/content/*` and `/api/UserStorage/Metadata` — Kobo Reading Services,
  exempted from the gate and authenticated by the `x-kobo-deviceid` header.
- `/opds/*` — a session, else HTTP Basic.
- `/metrics` — `OMNIBUS_METRICS_TOKEN`; the route does not exist until it is set.
- `/mcp` — a bearer token, gated per request on the admin `mcp_enabled` setting.
- `/api/ebooks/{uuid}/images/signed` — exempted from the gate and authenticated
  by a per-image HMAC link (`backend::ebooks::images`).

An admin can impersonate another account: a one-hour cookie session of the target
that carries `impersonator_id` (`auth::impersonation`). Stopping, or signing out of
it, swaps it for a fresh session of the admin.

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
- **Attribution.** Every user-facing name (journal author, reviewer, shelf owner)
  reads `COALESCE(display_name, username)`; `username` stays the login and admin
  identity.
- **Private notes.** A review's notes reach only their author: another reader
  gets an `AttributedReview`, which has no notes field, and nothing they see —
  the review's timestamps, the "Recently Interacted" sort — moves on an edit
  that touched only the notes.
- **Derived-byte caches.** Thumbnails, the KEPUB cache and the export-EPUB cache
  all invalidate on `books.last_modified`, so every metadata or cover write must
  bump it (`touch_book_last_modified`) or all three serve stale bytes.
- **Optional binaries.** Calibre and kepubify degrade rather than fail the
  boot: one startup warning, then conversion is disabled or the download falls
  back to plain EPUB.

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
| `src/index.html` | The feature tour: hero, nine feature sections, why switch, the rest of the shelf, close. All copy is real markup, never baked into an image. |
| `src/site.css` | From 1200px up, each section is a scaled copy of the 1440 desktop comp: positions are comp pixels times `--u`, one comp pixel at the current width. Below 1200px the page is the 390 phone comp's single column. |
| `src/app.js` | Swaps the static release line in "What only Omnibus does" for the latest release tag and the last 30 days' commit count from the GitHub API, and walks the desktop shelf's books round their ellipse. The page reads the same without it, and the orbit stays still under `prefers-reduced-motion`. |
| `src/shots/` | One transparent WebP per section and layout, `d-<section>` for desktop and `m-<section>` for phone, with the app screens and device frames already placed. The hero is the exception: `hero-cover.webp` is the bare cover, and its four pins are markup so they can float and light up in turn, top to bottom (still under `prefers-reduced-motion`). The shelf is the other: `shots/shelf/` holds one image per book, `d-*` for the desktop orbit and `m-*` for the phone stack, so each can move and wiggle on its own. |

The comps live in the Omnibus Marketing Figma file (`eQi5qV6AvHAuhccDT7HXrS`), page
"Proposal 5 · One Book's Life": desktop frame `34:1939`, phone frame `34:2313`.
Each stage image is that section's non-text layers exported at 2x over the Figma
REST API and composited in place, shadows included. The `style` attribute on each
section and stage carries its comp coordinates (`--fh`, `--cy`, `--x`, `--y`,
`--w`, and `--mx`/`--mw` for phone), so re-exporting a stage means updating those
numbers too.

The app screens in the comps are real UI. The web ones are screenshots of the React
client, some from a dev server and some (shelves, stats, a book's household) from
its Storybook components fed fixture data. The iOS widgets and CarPlay are drawn in
Figma from the SwiftUI and CarPlay template code, with the widget colors from the
app's own OKLCH tone formula.

Serve it locally with `python3 -m http.server 8000 --directory site/src`, and
check both layouts: 1200px and up, and the phone column below it.

## Keeping this current

- **A new module** documents itself in its own `//!` doc
  ([rule 05](../.claude/rules/05-rust-style.md)), or a Swift file in its header
  comment. Nothing is added here.
- **This file** changes only when how the pieces fit together changes: a crate,
  a request flow, or a design decision that spans modules.
