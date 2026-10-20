#!/usr/bin/env bash
# Run the Playwright suite locally the way CI's e2e.yml does: against the
# standalone `server` from a `dx bundle`, on a scratch database, rather than
# against `dx serve` and the long-lived dev DB.
#
# Usage: scripts/e2e-ci.sh [playwright args...]   (normally `just e2e-ci`)
#          e.g. scripts/e2e-ci.sh tests/flows/browse_indices.spec.ts
#
# Why not the dev server: its DB carries state between runs that CI's fresh
# one never has, and `dx serve`'s hot-reload client reloads pages mid-test.
# Both read as spec failures CI never sees.
#
# What it does:
#   1. `dx bundle` the fullstack web app. A debug build by default, sharing the
#      incremental artifacts `dx serve` uses, so an up-to-date bundle costs a
#      few seconds; OMNIBUS_E2E_RELEASE=1 builds `--release`, as CI does.
#   2. Starts the bundle's `server` in a scratch dir with its own DB, data,
#      covers and thumbs, on a free port in this worktree's window, with no
#      library paths and no seed admin: the specs seed their own library, and
#      Playwright registers the first (admin) account, as on CI.
#   3. Waits for /api/_health, then runs `pnpm exec playwright test` with CI=1
#      (CI's retries and forbid-only) and artifacts outside the source tree.
#   4. Always stops the server; keeps the scratch dir (server log, traces)
#      only when Playwright failed. Exits with Playwright's status.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/lib/dev-port.sh
source scripts/lib/dev-port.sh

: "${CARGO_TARGET_DIR:?run this through \`just e2e-ci\`, inside the nix dev shell}"
HEALTH_TIMEOUT_SECS=120

profile_args=()
bundle_dir="$CARGO_TARGET_DIR/e2e-ci/bundle"
if [ "${OMNIBUS_E2E_RELEASE:-}" = 1 ]; then
    profile_args=(--release)
    bundle_dir="$CARGO_TARGET_DIR/e2e-ci/bundle-release"
fi
# A relative CARGO_TARGET_DIR (CI pins ./target) would resolve inside $scratch.
case "$bundle_dir" in /*) ;; *) bundle_dir="$PWD/$bundle_dir" ;; esac

echo "e2e-ci: bundling the web app (${profile_args[*]:-debug})" >&2
dx bundle --platform web --package omnibus --fullstack --debug-symbols=false \
    ${profile_args[@]+"${profile_args[@]}"} --out-dir "$bundle_dir"

# Not under $TMPDIR: the nix shell points that at a fresh dir per invocation.
# Canonical (/tmp is /private/tmp on macOS) because the health wait compares
# it with the cwd the server reports. Two steps, so a failed mktemp aborts
# under set -e rather than leaving `cd ""` to make the worktree the scratch dir.
scratch="$(mktemp -d /tmp/omnibus-e2e-ci.XXXXXX)"
scratch="$(cd "$scratch" && pwd -P)"
server_pid=""
status=1

cleanup() {
    if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
        kill "$server_pid" 2>/dev/null || true
        for _ in $(seq 1 50); do
            kill -0 "$server_pid" 2>/dev/null || break
            sleep 0.1
        done
        kill -KILL "$server_pid" 2>/dev/null || true
    fi
    if [ "$status" -eq 0 ]; then
        rm -rf "$scratch"
    else
        echo "e2e-ci: kept $scratch (server.log, test-results/)" >&2
    fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if ! choice="$(choose_port --free-only)"; then
    echo "e2e-ci: no free port in $START_PORT-$END_PORT" >&2
    exit 1
fi
port="${choice%%:*}"
base_url="http://127.0.0.1:$port"

# The server must not see the developer's .env: library paths would index a
# second library, provider keys and SMTP would reach the network, and the dev
# rate-limit switch would hide limits CI enforces. Drop all of it, then set
# exactly what CI's server has.
unset_args=()
for name in ${!OMNIBUS_@} ${!SMTP_@} EBOOK_LIBRARY_PATH AUDIOBOOK_LIBRARY_PATH \
    HARDCOVER_API_KEY GOOGLE_BOOKS_API_KEY DATABASE_URL RUST_LOG; do
    unset_args+=(-u "$name")
done

# The scratch dir is also the server's working directory: /api/_health reports
# it as `repo_root`, so `just dev-up` walks past this server instead of
# adopting it as the worktree's dev server.
mkdir -p "$scratch/data"
(
    cd "$scratch"
    exec env ${unset_args[@]+"${unset_args[@]}"} \
        IP=127.0.0.1 PORT="$port" \
        DATABASE_URL="sqlite://$scratch/e2e.db?mode=rwc" \
        OMNIBUS_DATA_DIR="$scratch/data" \
        OMNIBUS_COVERS_DIR="$scratch/covers" \
        OMNIBUS_THUMBS_DIR="$scratch/thumbs" \
        OMNIBUS_PUBLIC_ORIGIN="$base_url,http://localhost:$port" \
        "$bundle_dir/server"
) >"$scratch/server.log" 2>&1 &
server_pid=$!

# Wait for *this* server: a concurrent run can pick the same free port, and
# the run whose server lost the bind would otherwise test the winner's.
MY_REPO_ROOT="$scratch"
echo "e2e-ci: waiting for $base_url/api/_health (log: $scratch/server.log)" >&2
deadline=$(($(date +%s) + HEALTH_TIMEOUT_SECS))
until kill -0 "$server_pid" 2>/dev/null &&
    is_my_omnibus_response "$(probe_health "$port")"; do
    if ! kill -0 "$server_pid" 2>/dev/null || [ "$(date +%s)" -ge "$deadline" ]; then
        echo "e2e-ci: the server never became healthy — end of its log:" >&2
        tail -n 30 "$scratch/server.log" >&2
        exit 1
    fi
    sleep 0.5
done

cd ui_tests/playwright
pnpm install --frozen-lockfile
set +e
# CI gives Playwright no seed user, so it signs in with its own default.
env -u OMNIBUS_DEV_SEED_USER CI=1 PLAYWRIGHT_BASE_URL="$base_url" \
    pnpm exec playwright test --output="$scratch/test-results" "$@"
status=$?
set -e
exit "$status"
