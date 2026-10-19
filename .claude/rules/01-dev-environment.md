# 01 — Dev environment

All system dependencies (Rust toolchain, SQLite, pkg-config, OpenSSL, Node.js, Android SDK/NDK, JDK) are provided by Nix. **Always** work inside the dev shell:

```bash
nix develop --command zsh   # preferred — keeps your shell prompt intact
nix develop                 # also works; spawns a bash subshell
```

## Shells

The flake exposes five purpose-built shells so daily cargo work doesn't pay for Playwright + mobile + audit tooling. Pick the smallest one that has what you need:

| Shell | Headline tools | When to use |
|---|---|---|
| `default` (slim) | rust core (+ `llvm-tools-preview`) + sqlite + openssl + just + zellij + process-compose + stylelint + cargo-llvm-cov | Daily `cargo test`/`clippy`/`fmt`, editor, rust-analyzer, `just lint-css`, `just coverage` — this is what direnv auto-loads via `.envrc` |
| `web` | default + dioxus-cli + matched `wasm-bindgen` + node + pnpm | `dx serve --platform web`, `just dev-up`, `just lint-ts`, anything that bundles the WASM client or drives the Playwright npm project |
| `e2e` | web + Playwright Chromium bundle | `pnpm exec playwright test`, the `playwright` pane in the multiplexer, CI's E2E job |
| `mobile` | own package set (not `default`-based) — rust core (Android targets) + sqlite + openssl + just + zellij + process-compose + sccache + dioxus-cli (`dx`) + Android rust-std targets + JDK 21 + Android SDK auto-detect (+ GTK 3 / WebKitGTK on Linux) | `dx serve --platform android`, `cargo build -p omnibus-mobile`; CI's `cargo clippy (mobile)` host-target lint |
| `audit` | default + cargo-audit + cargo-deny | Local `cargo audit` / `cargo deny`, mirrors CI's security job |

One-shot pattern for any non-default shell:

```bash
nix develop .#web    --command dx serve --platform web -p omnibus
nix develop .#audit  --command cargo deny check advisories sources bans
nix develop .#mobile                  # interactive shell with the Android NDK + targets
```

`.envrc` resolves `use flake` to `default`, so the editor stays on the slim shell at all times. `just serve` works from default because zellij + process-compose live there; each multiplexer pane internally wraps its command in the right `.#shell` (server and react → `.#web`, android → `.#mobile`, playwright → `.#e2e`), so only the panes you actually start realize their extras — except the native `ios` pane, which runs `just ios-sim` on system xcodebuild + simctl and needs no nix shell at all. `just dev-up` and `just dev-bounce` self-wrap in `.#web`, so they work straight from default too.

If a task requires a new system dependency, add it to [flake.nix](../../flake.nix) rather than documenting a manual install step.

## Cached dev-env for hot recipes

Each `nix develop` invocation re-copies the flake source into `/nix/store` and re-evaluates the flake. To avoid paying that on every `just` run, the hot recipes (`dev-up`, `dev-bounce`, `lint`, `lint-css`, `test`) go through [`scripts/with-dev-env.sh`](../../scripts/with-dev-env.sh) `<shell> <cmd…>` instead: it captures `nix print-dev-env .#<shell>` once, cached under `.claude/runtime/nix-env-cache/` keyed on `sha256(flake.nix + flake.lock + shell)`, then sources it (re-running the shellHook, so per-workspace `PORT`/`.env`/sccache stay live) and execs the command. On a cache hit this skips Nix entirely; only a flake edit — or a `nix store gc` collecting a referenced path (the wrapper spot-checks and self-heals) — forces a rebuild. Interactive shells and the cold `.#mobile`/multiplexer paths stay on plain `nix develop`. Escape hatches: `OMNIBUS_NO_ENV_CACHE=1` bypasses the cache; `just env-clear` deletes it.

## Test fixtures

The public-domain test fixtures (`test_data/{epubs,audiobooks}/public_domain/`, ~156 MB of binaries) are **not in git** — they live as a GitHub release asset (`fixtures-vN`) so `nix develop`'s tree-copy into /nix/store stays small. Fresh checkout bootstrap:

```bash
just fixtures    # one-time download; instant no-op thereafter
```

`just test` runs it automatically; Playwright's `globalSetup` and the `db` public-domain tests fail with a "run `just fixtures`" pointer when missing. Publishing a new fixture set: `scripts/publish-fixtures.sh v<N>` (see [test_data/epubs/README.md](../../test_data/epubs/README.md)).

## CSS structural lint

`stylelint` lives in the slim shell so `just lint` (which runs `just lint-css`) and the `css-lint.yml` CI job both guard `frontend/assets/**.css` against structural errors — chiefly an unclosed `}`, which under CSS nesting silently reparents every following rule as a descendant of the unclosed selector and breaks layouts the Rust/web build never exercises. The ruleset ([`.stylelintrc.json`](../../.stylelintrc.json)) is parse/structural-only, so it errors on broken CSS but never nags about pre-existing style. Run `just lint-css` to check just the CSS.

## Code coverage

`cargo-llvm-cov` (backed by the `llvm-tools-preview` toolchain component, both in the slim shell) drives LLVM source-based coverage over the same crate/feature matrix as `just test`, running the tests via **cargo-nextest** (also slim-shell). The whole workspace runs on nextest — `just test`, `just coverage`, and the CI `test` job — so local and CI exercise the same runner; there are no doctests (all nextest would skip). Run `just coverage` for an lcov + per-file summary, or `just coverage-html` for a browsable per-line report. In CI the `test` job in [`rust.yml`](../../.github/workflows/rust.yml) runs `cargo llvm-cov nextest` (one instrumented pass — coverage falls out of the same run that gates correctness) and each matrix variant uploads its lcov to Codecov, configured report-only via [`codecov.yml`](../../codecov.yml) (informational status, never a merge gate; a Codecov upload hiccup never fails the gated job). Two deliberate blind spots for *line* coverage: the wasm32 `web` frontend can't be instrumented, and the E2E suites aren't included — so read the absolute number as a floor, and lean on **patch coverage** (did this PR test its new logic?) rather than the project total.

The native SwiftUI app has its own coverage lane: [`ios-tests.yml`](../../.github/workflows/ios-tests.yml) runs the `omnibusTests` suite on a simulator via [`scripts/ios-test.sh`](../../scripts/ios-test.sh) (a dedicated `omnibus-tests` device it creates on the newest installed iPhone runtime and pre-boots, path-gated on `omnibus-ios/**` with the same skipped-counts-as-pass `ci-gate` pattern as rust.yml), converts the `.xcresult` archive to lcov with [`scripts/xccov-to-lcov.sh`](../../scripts/xccov-to-lcov.sh), and uploads it under the `ios` flag in `codecov.yml` — report-only, like the Rust lanes.

**Test Analytics** (flaky-test / failure-rate tracking) is separate from line coverage: every CI suite emits JUnit and uploads it via `codecov/codecov-action@v5` with `report_type: test_results` — Rust through nextest's `ci` profile ([`.config/nextest.toml`](../../.config/nextest.toml)), Playwright through its `junit` reporter ([`e2e.yml`](../../.github/workflows/e2e.yml)), and the iOS unit + UI suites through `xcbeautify --report junit` ([`ios-tests.yml`](../../.github/workflows/ios-tests.yml)). These uploads are best-effort and never gate a merge. Both coverage and Test Analytics want a `CODECOV_TOKEN` repo secret to be reliable; tokenless OIDC upload works for the public repo but is rate-limited.

## Common environment

Every shell sets:

- `DATABASE_URL=sqlite://omnibus.db?mode=rwc`
- `CARGO_TARGET_DIR=$HOME/.cache/cargo-target/<worktree-root-name>` — keeps `target/` outside the repo so flake evaluations don't snapshot multi-GB build artifacts into `/nix/store` on every direnv reload. The worktree root is resolved via `git rev-parse --show-toplevel` (so `nix develop` from a subdir picks the same dir), and the basename keeps it per-worktree to avoid races between parallel worktrees.
- `OMNIBUS_PUBLIC_ORIGIN=http://localhost:$PORT` — comma-separated allowlist consumed by `auth::origin_check`. Required for `dx serve --fullstack`: its HTTP proxy rewrites `Host` to the upstream backend's loopback address without setting `X-Forwarded-Host`, so without an allowlist every cookie-authed POST 403s. Override in production deployments behind a reverse proxy. `just serve` / `just serve-pc` bind dx serve to `--addr 0.0.0.0` (override with `OMNIBUS_DEV_ADDR`) so other LAN devices can reach `http://<lan-ip>:$PORT` — **trusted networks only**, since that exposes the dev server (auth endpoints included) to the whole LAN; to authenticate from a LAN client, override this var to include the LAN origin and set `OMNIBUS_SECURE_COOKIES=0` (see [.env.example](../../.env.example)).
- `RUSTC_WRAPPER=sccache` + `CARGO_INCREMENTAL=0` + `SCCACHE_DIR=$HOME/.cache/sccache` + `SCCACHE_CACHE_SIZE=20G` — **local dev shells only** (nested inside the same `CARGO_TARGET_DIR`-unset guard, so CI — which pins `CARGO_TARGET_DIR=./target` and caches `target/` via `Swatinem/rust-cache` — is excluded automatically). Routes rustc through [sccache](https://github.com/mozilla/sccache) so identical crate builds are shared across every worktree via one cache at `$HOME/.cache/sccache` (build once, reuse everywhere). `SCCACHE_DIR` is pinned explicitly because sccache's default location is platform-specific (`~/.cache/sccache` on Linux, `~/Library/Caches/Mozilla.sccache` on macOS) — pinning keeps the shared cache in one place across worktrees and platforms. Incremental compilation is turned **off** deliberately: its per-crate codegen caches are what balloon each worktree's `target/` to tens of GB, and sccache can't cache incremental units — the two are mutually exclusive, so incremental-off is what makes sccache effective. Export `OMNIBUS_NO_SCCACHE=1` to opt out (restores incremental rebuilds — faster inner loop on the crate you're actively editing, at the cost of the `target/` bloat). Override `SCCACHE_CACHE_SIZE` to resize the shared cache (default 20G).

Shell-specific additions:

- `web`/`e2e` — `pnpm` is the package manager for the Playwright npm project (`ui_tests/playwright`); do **not** use `npm`. The version is pinned via the project's `packageManager` field and provisioned by Nix; the project's `.npmrc` sets `manage-package-manager-versions=false` so that field never triggers a network pnpm fetch, and `pnpm-workspace.yaml` allowlists esbuild's build script. Run tools with `pnpm exec <bin>` (e.g. `pnpm exec playwright test`, `pnpm exec tsx tools/make_epub.ts`).
- `e2e` only — `PLAYWRIGHT_BROWSERS_PATH` → Nix-provided Chromium (don't run `pnpm exec playwright install`)
- `mobile` only — `ANDROID_HOME`, `ANDROID_NDK_HOME` (auto-detected from standard Android Studio install paths), plus the Xcode `DEVELOPER_DIR`/`SDKROOT`/`PATH` shim on macOS

If `ANDROID_HOME` / `ANDROID_NDK_HOME` come back empty inside `nix develop .#mobile`, set them manually:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/$(ls $ANDROID_HOME/ndk | tail -1)
```

## Per-worktree ports

Every worktree gets its own 10-port window, so two of them can run a dev server at the same time without either one noticing. The shellHook assigns the window base: the **main checkout** (directory name `omnibus`) keeps `PORT=3000`; any other worktree hashes its directory name into one of 90 windows at `3010..3900`. It's derived, so a `wt switch --create` worktree is isolated without being registered anywhere, and stable, so a branch keeps the same URL across sessions.

Both launchers then walk `$PORT..$PORT+9` before binding, and identity-check `/api/_health`'s `repo_root` so they skip a *sibling* worktree's server rather than adopting it:

- `just dev-up` → [`scripts/dev-server-up.sh`](../../scripts/dev-server-up.sh) — daemonized; **reuses** this worktree's server if one is already healthy.
- `just serve` / `just serve-pc` → [`scripts/dev-serve-fg.sh`](../../scripts/dev-serve-fg.sh) — foreground, so the pane owns the process; walks *past* its own running server rather than reusing (a pane is being asked to run one).

Both publish the chosen port to `.claude/runtime/{port,env.sh}`. The serve panes also reserve the next free port above it for the React client (`scripts/react-dev-fg.sh`, the `react` pane and `just react`), allowlist that origin in `OMNIBUS_PUBLIC_ORIGIN` (dx's proxy rewrites `Host`, so `origin_check` can't match it otherwise), and publish it to `.claude/runtime/react-port`. A hash collision between two worktrees is therefore not a failure — the second walks to a free port inside the shared window. Shared helpers live in [`scripts/lib/dev-port.sh`](../../scripts/lib/dev-port.sh); a second copy of the walk would let the two front doors hand one port to two worktrees.

Override `PORT` before `nix develop` to pick a different window base. Playwright targets `$PLAYWRIGHT_BASE_URL` (written by both launchers); it falls back to `http://127.0.0.1:3000` when unset — so `source .claude/runtime/env.sh` rather than assuming 3000.

Two related knobs (both in [.env.example](../../.env.example)): `OMNIBUS_DEV_BUILD_TIMEOUT_SECS` (default 900) is how long `dev-up` waits for a new server to answer `/api/_health` — generous because a fresh worktree compiles the whole workspace into an empty `CARGO_TARGET_DIR`, and safe because a compile error is caught when `dx` exits rather than by waiting the clock out. `OMNIBUS_DEV_ADDR` (default `0.0.0.0`) is the bind address for the `serve` panes.

## Environment variables

Anything secret or per-developer lives in a gitignored `.env` at the repo root, copied from [`.env.example`](../../.env.example) on first checkout; the shellHook sources it **after** its own exports, so `.env` wins. `.env.example` lists every supported variable with an example value.

The three a dev or test loop touches:

- `OMNIBUS_DEV_SEED_USER=user:password` — the admin a debug build creates at boot (a release build ignores it), and the login `ui-validate`, `mock-kobo` and Playwright's `globalSetup` sign in with, so Playwright needs it in its own env too.
- `OMNIBUS_DEV_DISABLE_RATE_LIMITS=1` — turns the per-IP limiters off in debug builds (the per-account lockout stays); read once at boot.
- `EBOOK_LIBRARY_PATH` / `AUDIOBOOK_LIBRARY_PATH` — rewrite the settings row's library paths on **every** boot, so set both or neither; a restart undoes any path a spec's `seedLibrary` or the Settings page saved.

Before setting, adding or changing any other variable, read [docs/environment.md](../../docs/environment.md): what each one does that its name doesn't say — whether Settings or the env wins, the security-sensitive ones, the storage paths a deployment must make absolute.
