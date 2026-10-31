{
  description = "Omnibus dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
    # Pinned to a rev: fenix follows it, so a bump moves the Rust toolchain,
    # node and pnpm together, on purpose.
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/5adc50831c259f87faeb09ddf930d43597197473";
    # Pinned solely for `playwright-driver.browsers`. Kept separate from
    # nixpkgs-unstable so moving the Chromium bundle does not also move the
    # Rust toolchain and node — the browser version has to track
    # the npm @playwright/test pin, and nothing else should be dragged along
    # for that. Bump this rev and `@playwright/test` together, never apart.
    nixpkgs-playwright.url = "github:NixOS/nixpkgs/319e4cebef10cbb636c6ea392137b52ad105336a";
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs-unstable";
    };
  };

  outputs = { self, nixpkgs, nixpkgs-unstable, nixpkgs-playwright, flake-utils, fenix }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        pkgs-unstable = import nixpkgs-unstable { inherit system; };
        pkgs-playwright = import nixpkgs-playwright { inherit system; };

        # Slim core Rust toolchain.
        rustCore = fenix.packages.${system}.combine [
          fenix.packages.${system}.latest.cargo
          fenix.packages.${system}.latest.rustc
          fenix.packages.${system}.latest.rustfmt
          fenix.packages.${system}.latest.clippy
          fenix.packages.${system}.latest.rust-src
          # llvm-profdata / llvm-cov backing cargo-llvm-cov (`just coverage`).
          # Must match the rustc above — pinning both from the same fenix
          # `latest` keeps the instrumentation and the profdata reader in lockstep.
          fenix.packages.${system}.latest.llvm-tools-preview
        ];

        # Package buckets per shell. The slim default carries only what
        # everyday cargo/rust-analyzer work needs; opt-in shells layer their
        # extras on top. zellij + process-compose live in `default` so
        # `just serve` / `just serve-pc` work from a fresh checkout without
        # an extra bootstrap step — they're ~10 MB each and harmless.
        slimPackages = [
          pkgs-unstable.git
          # The agentic-exploration scripts (scripts/explore/) shell out to all
          # three: curl for the instance's HTTP API, python3 for JSON handling,
          # and lsof for driver.sh's port ownership. macOS supplies them
          # system-wide, which is why their absence here went unnoticed — a
          # clean Linux host or CI runner has no such luck.
          pkgs.curl
          pkgs.python3
          pkgs.lsof
          # KOReader's Lua is LuaJIT: the plugin's unit tests (`just koreader-plugin-test`).
          pkgs.luajit
          # The stdenv's bash is built without readline; `just koreader`'s prompt (`read -e`) needs it for Tab completion.
          pkgs.bashInteractive
          pkgs.sqlite
          pkgs.pkg-config
          pkgs.openssl
          rustCore
          pkgs.zellij
          # process-compose pinned to unstable for a fresher build than the
          # v1.64.1 that nixpkgs-stable (25.05) ships. The original driver
          # (`is_interactive: true`) was reverted from process-compose.yaml
          # because it pinned panes to a PTY that detached from the TUI log
          # pane, but we keep the newer build for general quality-of-life
          # fixes and to leave room for future config keys.
          pkgs-unstable.process-compose
          pkgs.just
          # Compiler cache shared across all worktrees. Paired with
          # CARGO_INCREMENTAL=0 in commonShellHook so identical crate builds
          # are fetched from one cache instead of each worktree's target/
          # rebuilding (and incrementally re-caching) the same dependency tree.
          pkgs.sccache
          # Coverage driver for `just coverage` / the CI coverage job. Wraps the
          # LLVM source-based instrumentation; pairs with the llvm-tools-preview
          # component in rustCore. In slim because it runs the same native test
          # matrix as `just test`. From unstable because the stable-pinned
          # nixpkgs marks cargo-llvm-cov broken.
          # shortcut: 0.9.0's own test suite fails in the Nix sandbox, so skip it; drop once cache.nixos.org serves a build.
          (pkgs-unstable.cargo-llvm-cov.overrideAttrs { doCheck = false; })
          # Test runner for `just test` / `just coverage` and the CI `test` job.
          # Drives coverage via `cargo llvm-cov nextest` and emits JUnit (the
          # `.config/nextest.toml` `ci` profile) for Codecov Test Analytics —
          # plain `cargo test` produces neither. No doctests in the tree, so
          # nextest (which can't run them) drops no coverage.
          pkgs.cargo-nextest
        ];

        # Web extras: node + pnpm + ffmpeg + kepubify. Node + pnpm build the
        # React client (frontend-js/) the dev server serves, and run the
        # Playwright npm project's tooling (e.g. `ui_tests/playwright/tools/`,
        # via `pnpm exec tsx …`). pnpm is the package manager for both npm
        # projects (each `packageManager` field pins the matching version); its
        # build-script allowlist and version self-management are configured in
        # each project's `pnpm-workspace.yaml` / `.npmrc`. ffmpeg is the runtime backend for the F2.3 audiobook HLS
        # pipeline (`db::hls` shells out via OMNIBUS_FFMPEG_PATH); kept out of
        # slim `default` since daily cargo work doesn't need it. kepubify is the
        # EPUB→KEPUB converter for the F4.1 "Send to Kobo" download
        # (`db::kepub` shells out via OMNIBUS_KEPUBIFY_PATH).
        webExtras = [
          pkgs-unstable.nodejs_22
          pkgs-unstable.pnpm
          pkgs.ffmpeg-headless
          pkgs.kepubify
        ];

        # E2E extras layer on top of webExtras: Playwright's Nix-provided
        # Chromium bundle. The PLAYWRIGHT_BROWSERS_PATH export below pins it.
        e2eExtras = [
          pkgs-playwright.playwright-driver.browsers
        ];

        # CI / occasional-local audit tooling. Not needed for daily work.
        auditExtras = [
          pkgs-unstable.cargo-audit
          pkgs-unstable.cargo-deny
        ];

        # Common shellHook fragment shared by every shell: parks
        # CARGO_TARGET_DIR outside the repo so flake evals don't snapshot
        # ~12 GB of build artifacts into /nix/store, assigns the worktree's
        # port window, and sources a per-repo `.env` last so it can override
        # any default above.
        commonShellHook = ''
          # Keep target/ out of the repo so flake evaluations don't snapshot
          # ~12GB of build artifacts into /nix/store on every direnv reload.
          # Resolve the repo root so `nix develop` from a subdir lands in the
          # same target dir; basename keeps it per-worktree so parallel
          # worktrees don't race.
          # Skip if the caller already pinned CARGO_TARGET_DIR (CI sets it to
          # ./target so workflow paths and rust-cache stay valid). This branch
          # therefore only runs for local dev shells, which is also where we
          # want sccache — so the sccache wiring lives inside it.
          if [ -z "''${CARGO_TARGET_DIR:-}" ]; then
            _cargo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
            export CARGO_TARGET_DIR="$HOME/.cache/cargo-target/$(basename "$_cargo_root")"

            # Route rustc through sccache so identical crate compilations are
            # shared across every worktree (build once, reuse everywhere) via a
            # single cache at $HOME/.cache/sccache, instead of each worktree's
            # target/ independently rebuilding the same dependency tree.
            # CARGO_INCREMENTAL=0 is required, not incidental: incremental
            # codegen caches are what balloon each worktree's target/ to tens of
            # GB, and sccache cannot cache incremental units — the two are
            # mutually exclusive, so incremental-off is what makes sccache
            # effective. Left OUT of the CI branch above on purpose: CI persists
            # target/ via Swatinem/rust-cache, so a cold, unpersisted sccache
            # would only add per-crate wrapper overhead with no cache benefit.
            # Opt out (restore incremental rebuilds) with OMNIBUS_NO_SCCACHE=1.
            if [ -z "''${RUSTC_WRAPPER:-}" ] && [ -z "''${OMNIBUS_NO_SCCACHE:-}" ]; then
              export RUSTC_WRAPPER="sccache"
              export CARGO_INCREMENTAL=0
              # Pin the cache dir so every worktree shares one location and it's
              # the same across platforms (sccache's default is ~/.cache/sccache
              # on Linux but ~/Library/Caches/Mozilla.sccache on macOS).
              export SCCACHE_DIR="''${SCCACHE_DIR:-$HOME/.cache/sccache}"
              export SCCACHE_CACHE_SIZE="''${SCCACHE_CACHE_SIZE:-20G}"
            fi
          fi

          # Per-worktree stable PORT — every worktree gets its own 10-port
          # window so two of them never start their walk at the same base.
          # The main checkout keeps 3000; any other worktree hashes its
          # directory name into one of 90 windows at 3010..3900. Stable, so
          # a branch keeps the same URL across sessions, and derived, so a
          # `wt switch --create` worktree is isolated without anyone
          # registering it anywhere.
          #
          # A hash collision is not a failure: both launchers port-walk
          # $PORT..$PORT+9 and identity-check /api/_health's repo_root, so
          # the second worktree lands on a free port inside the shared
          # window instead of stealing the first one's server.
          # Override by exporting PORT before `nix develop`.
          if [ -z "''${PORT:-}" ]; then
            _ws_name="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"
            if [ "$_ws_name" = "omnibus" ]; then
              export PORT=3000
            else
              _ws_hash="$(printf '%s' "$_ws_name" | cksum | cut -d' ' -f1)"
              export PORT=$((3010 + (_ws_hash % 90) * 10))
            fi
          fi

          # Source per-repo .env last so it can override any default set
          # above. Look in the worktree root (resolved via git so
          # `nix develop` from a subdir still picks it up); fall back to
          # the current dir. `.env` is gitignored and is meant for
          # secret-bearing or per-developer values only — non-secret
          # defaults live in this shellHook. `.env.example` is the
          # checked-in template.
          _env_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
          if [ -f "$_env_root/.env" ]; then
            set -a
            # shellcheck disable=SC1090
            source "$_env_root/.env"
            set +a
          fi
        '';

        # `e2e` shell pins Playwright's Chromium to the Nix store. The npm
        # @playwright/test version must match this bundle's version — each
        # Playwright minor expects a specific Chromium build number, so the
        # `nixpkgs-playwright` rev and the `@playwright/test` range move
        # together or not at all.
        #
        # The agentic-exploration driver (scripts/explore/driver/) pins its own
        # transitive `playwright` to the same version for the same reason, so
        # it shares this bundle instead of downloading a second Chromium.
        playwrightHook = ''
          export PLAYWRIGHT_BROWSERS_PATH="${pkgs-playwright.playwright-driver.browsers}"
          export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
        '';

        mkShell = { name, packages, extraHook ? "" }:
          pkgs.mkShell {
            inherit packages;
            DATABASE_URL = "sqlite://omnibus.db?mode=rwc";
            shellHook = ''
              echo "Nix dev shell ready (${name})."
            '' + commonShellHook + extraHook;
          };
      in {
        devShells = {
          # Slim default — covers daily cargo/clippy/fmt/test and the
          # `rust.yml` CI jobs. Anything node- or Playwright-shaped lives in
          # an opt-in shell below.
          default = mkShell {
            name = "default";
            packages = slimPackages;
          };

          # Web dev: node + pnpm for the React client. Used by `just dev-up`,
          # `just react`, and the server and react panes in the multiplexer.
          web = mkShell {
            name = "web";
            packages = slimPackages ++ webExtras;
          };

          # End-to-end browser tests: web extras + Playwright's Chromium
          # bundle, with PLAYWRIGHT_BROWSERS_PATH pinned to the Nix store.
          # Used by `e2e.yml` and the playwright pane in the multiplexer.
          e2e = mkShell {
            name = "e2e";
            packages = slimPackages ++ webExtras ++ e2eExtras;
            extraHook = playwrightHook;
          };

          # Security tooling: cargo-audit + cargo-deny. Used by
          # `rust.yml/security` and the occasional local audit.
          audit = mkShell {
            name = "audit";
            packages = slimPackages ++ auditExtras;
          };
        };
      });
}
