# Local development

Everything you need to build, run, and test Omnibus from source. If you only
want to *run* a server, use [Docker](docker.md) instead — this page is for
working on the code.

Omnibus is a Rust server ([Axum](https://github.com/tokio-rs/axum)) over SQLite,
a React web client in `frontend-js/`, and a native SwiftUI iOS app.

## Prerequisites

[Nix](https://wiki.nixos.org/wiki/NixOS_Wiki) pins every dependency — the Rust
toolchain, SQLite, Node, pnpm. **Always work inside the dev shell.**

```bash
nix develop                 # slim default shell (spawns bash)
nix develop --command zsh   # …keeping your shell
direnv allow                # or auto-load via direnv (once)
```

macOS extras, only if you build the iOS app: Xcode with at least one iOS
Simulator installed, and `jq` on `PATH`.

## Running the app

**The `just` recipes are the quickest way in.** They self-wrap in the right Nix
shell, so they run straight from the slim `default` shell:

```bash
just serve       # full stack in Zellij — server + React + iOS + Playwright panes
just serve-pc    # …the same stack via process-compose
just dev-up      # just the server, serving the React build: port-walks, seeds the admin user
just dev-status  # what's running, on which port
just dev-bounce  # restart the dev server — after a Rust change or a migration
just dev-down    # stop it
just react       # the React client under Vite, hot-reloading, proxying /api to the dev server
```

Prefer to drive the pieces yourself? From `nix develop .#web`:

```bash
pnpm --dir frontend-js install
pnpm --dir frontend-js run build                              # the web client, into frontend-js/dist
OMNIBUS_REACT_DIR=$PWD/frontend-js/dist cargo run -p omnibus  # the server on $PORT, serving it at /
```

The server doesn't rebuild itself: a Rust change needs a restart
(`just dev-bounce`). Without `OMNIBUS_REACT_DIR` the API still answers and `/`
is a 503.

Every worktree gets its own 10-port window, so two checkouts can serve at once
without colliding. Both launchers publish the port they picked to
`.claude/runtime/env.sh` — `source` it rather than assuming `:3000`.

## Nix shells

The flake exposes purpose-built shells so daily cargo work doesn't pull in
Node, Playwright and audit tooling. Opt into a heavier shell only when you need
it (the `just` recipes above pick the right one for you):

| Shell | When to use |
|---|---|
| `default` | Daily `cargo` / `clippy` / `test` / editor — what direnv auto-loads |
| `.#web` | `just dev-up`, `just react`, anything that builds `frontend-js/` (node, pnpm) |
| `.#e2e` | `pnpm exec playwright test` (the Chromium bundle lives here) |
| `.#audit` | `cargo audit` / `cargo deny` |

The native iOS app needs no Nix shell.

## Configuration

The shell sets non-secret defaults:

| Variable | Default |
|---|---|
| `PORT` | `3000` (per-worktree window base) |
| `DATABASE_URL` | `sqlite://omnibus.db?mode=rwc` |
| `CARGO_TARGET_DIR` | `~/.cache/cargo-target/<worktree>` |

Secret-bearing config lives in a gitignored `.env` — copy
[`.env.example`](../.env.example) on first checkout. It's the canonical,
annotated reference for every supported variable (library paths, metadata
provider keys, SMTP, storage overrides).

## Test fixtures

The public-domain EPUB/audiobook fixtures aren't in git — they live as a GitHub
release asset so Nix's tree-copy stays small:

```bash
just fixtures    # one-time download; instant no-op thereafter
```

`just test` runs it for you; Playwright's `globalSetup` and the public-domain db
tests fail with a pointer to it when they're missing.

## Tests & lint

```bash
just test    # full matrix: db + server + shared + mcp + mock-kobo, then the script suites
just lint    # cargo fmt --check + clippy, mcp and mock-kobo included
just check   # lint then test

just coverage       # lcov + per-file summary via cargo-llvm-cov over nextest
just coverage-html  # browsable per-line report
```

### The REST contract

`openapi/openapi.json` describes every `/api/*` route and is generated from the
handlers. After changing a route or a type in `shared/`, regenerate it and commit
the result; a test fails until you do.

```bash
just openapi-gen  # rewrite openapi/openapi.json
just openapi      # regenerate, then browse it as an API reference on a local port
```

Per-crate, when you want a tighter loop. `cargo test` alone skips `mcp` and
`mock-kobo` (out of default-members), so name them explicitly:

```bash
cargo test -p omnibus                              # /api/* REST integration tests
cargo test -p omnibus-db                           # db + scanner + sync tests
cargo test -p omnibus-shared                       # shared serde / ebook / progress tests
cargo test -p omnibus-mcp                          # MCP tool layer (out of default-members)
cargo test -p omnibus-mock-kobo                    # fake Kobo firmware tests (out of default-members)
```

### Web E2E (Playwright)

`just e2e-ci` runs the suite the way CI does: it builds the server and the React
client, starts the server on a scratch database, runs the specs and stops the server.
Pass spec paths (relative to `ui_tests/playwright`) to run a subset:

```bash
just e2e-ci                                   # whole suite
just e2e-ci tests/flows/browse_indices.spec.ts
```

To run against a dev server you already have up instead, Chromium comes from
Nix. The project uses **pnpm** (not npm) and TypeScript 7, with Biome as
linter/formatter:

```bash
cd ui_tests/playwright
pnpm install                # first time only; do NOT run `pnpm exec playwright install`
pnpm exec playwright test
just lint-ts                # biome check + tsc --noEmit
```

## iOS app

The native SwiftUI app under `omnibus-ios/` talks to a running Omnibus server,
so **start the server first** (`just serve` handles this). The Android
app lives in its own repo, `omnibus-android`.

In both multiplexers only the server starts on its own — the `react`, `ios`,
and `playwright` panes are preloaded but idle (press Enter in the Zellij pane,
or select it and press F7 in process-compose).

An Xcode project (`omnibus-ios/omnibus.xcodeproj`, scheme `omnibus`) rather than
a Cargo crate — it speaks the same `/api/*` REST surface, and `cargo` never
builds it. Its recipes drive system `xcodebuild` / `simctl`, so none of them
enter a Nix shell:

```bash
just ios-sim      # boot the newest iPhone simulator, build, install, launch
just ios-build    # compile check against a generic simulator destination
just ios-test     # omnibusTests unit suite — the invocation CI runs
just ios-test-ui  # omnibusUITests
```

The app has no baked-in server URL — `just ios-sim` prints this workspace's dev
server URL to enter on the Connect screen. Pin a specific simulator with
`OMNIBUS_IOS_SIM_UDID` if you don't want the newest iPhone runtime. The two
test recipes never touch that simulator: `scripts/ios-test.sh` creates its own
`omnibus-tests` device on the newest iPhone runtime (name it with
`OMNIBUS_IOS_SIM_NAME`, pin one with `OMNIBUS_IOS_TEST_SIM_UDID`) and reuses
it, because the UI suite's `--uitest-reset` wipes the stored server and token
on whatever device it runs against. That pin overrides the dedicated device
and so takes the reset itself — point it at a disposable simulator, never at
the one above.

## Project layout

Five-crate Cargo workspace:

| Crate | Responsibility |
|---|---|
| `shared/` | serde types shared across crates |
| `db/` | data layer, indexer, migrations |
| `server/` | the `omnibus` binary: REST router, Kobo, KOReader, OPDS, the web client at `/` |
| `mcp/` | MCP tool layer over the `/api/*` surface (out of default-members) |
| `mock-kobo/` | fake Kobo e-reader that syncs against the Kobo routes (out of default-members) |

Alongside it, `frontend-js/` holds the React web client (Vite + pnpm, with its
own checks: biome, tsc, vitest) and `omnibus-ios/` the native SwiftUI iOS client — an Xcode
project, not a Cargo crate, so `cargo` / `just lint` / `just test` never touch
it. `site/` is the marketing site published to GitHub Pages (static HTML, no
build step).

## Conventions

Deeper architecture — crates, request flows, the REST contract — is in
[architecture.md](architecture.md), and the iOS app's design in [ios.md](ios.md).
Per-module detail lives in each file's own `//!` doc; `just modules <dir>`
prints a directory's map from them. The rules contributors follow live under
[.claude/rules/](../.claude/rules/):

| Topic | Rule |
|---|---|
| Dev environment | [01-dev-environment.md](../.claude/rules/01-dev-environment.md) |
| Environment variables | [environment.md](environment.md) |
| Error handling | [02-error-handling.md](../.claude/rules/02-error-handling.md) |
| Unit & integration testing | [03-unit-testing.md](../.claude/rules/03-unit-testing.md) |
| Playwright E2E conventions | [04-playwright.md](../.claude/rules/04-playwright.md) |
| Rust style | [05-rust-style.md](../.claude/rules/05-rust-style.md) (rationale in [style-guide.md](style-guide.md)) |
| SQL migrations | [06-migrations.md](../.claude/rules/06-migrations.md) |
| Offline write queueing | [08-offline-writes.md](../.claude/rules/08-offline-writes.md) |
| Content validators / ETags | [09-content-validators.md](../.claude/rules/09-content-validators.md) |
| Serving bytes: `serve_file`, preconditions, `Vary` | [09a-serving-validated-bytes.md](../.claude/rules/09a-serving-validated-bytes.md) |

UI work also has a design system: [design/atrium-design-system.md](design/atrium-design-system.md).
