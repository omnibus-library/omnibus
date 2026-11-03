#!/usr/bin/env bash
# Run the Playwright suite locally the way CI's e2e.yml does: against a freshly
# built server serving the React client at `/` on a scratch database, rather
# than against the dev server and its long-lived DB.
#
# Usage: scripts/e2e-ci.sh [playwright args...]   (normally `just e2e-ci`)
#          e.g. scripts/e2e-ci.sh tests/flows/browse_indices.spec.ts
#
# Why not the dev server: its DB carries state between runs that CI's fresh
# one never has, which reads as spec failures CI never sees.
#
# What it does:
#   1. `cargo build -p omnibus`. A debug build by default, sharing the dev
#      server's artifacts, so an up-to-date build costs a few seconds;
#      OMNIBUS_E2E_RELEASE=1 builds `--release`, as CI does.
#   2. Builds the React client into a scratch dir.
#   3. Starts the server in that dir with its own DB, data, covers and thumbs,
#      serving the client at `/`, on a free port in this worktree's window,
#      with no library paths and no seed admin: the specs seed their own
#      library, and Playwright registers the first (admin) account, as on CI.
#   4. Waits for /api/_health, then runs `pnpm exec playwright test` with CI=1
#      (CI's retries and forbid-only) and artifacts outside the source tree.
#   5. Always stops the server; keeps the scratch dir (server log, traces)
#      only when Playwright failed. Exits with Playwright's status.
#
# Steps 1-3 (and the teardown in 5) live in scripts/lib/scratch-server.sh,
# shared with scripts/koreader-e2e.sh.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/lib/dev-port.sh disable=SC1091
source scripts/lib/dev-port.sh
# shellcheck source=scripts/lib/scratch-server.sh
source scripts/lib/scratch-server.sh

label=e2e-ci
kept_hint="server.log, react.log, test-results/"
build_server
make_scratch_dir
build_react_client
start_scratch_server OMNIBUS_REACT_DIR="$scratch/react"

cd ui_tests/playwright
pnpm install --frozen-lockfile
set +e
# CI gives Playwright no seed user, so it signs in with its own default.
env -u OMNIBUS_DEV_SEED_USER CI=1 PLAYWRIGHT_BASE_URL="$base_url" \
    pnpm exec playwright test --output="$scratch/test-results" "$@"
status=$?
set -e
exit "$status"
