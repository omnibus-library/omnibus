#!/usr/bin/env bash
# Shared scratch-server bring-up for the standalone E2E lanes.
#
# Sourced by scripts/e2e-ci.sh and scripts/koreader-e2e.sh after `cd` to the
# repo root and after scripts/lib/dev-port.sh. Both lanes need the same
# thing: a `dx bundle` of the web app, and that bundle's standalone `server`
# on a scratch DB and data dirs at a free port in this worktree's window,
# torn down afterwards. A second copy of the bring-up would let the two
# lanes drift.
#
# Callers set `label` (log-line prefix) and may pre-set `scratch` to a dir
# they already created and seeded; otherwise:
#
#   bundle_web_app                              # sets bundle_dir
#   start_scratch_server <prefix> [NAME=value ...]
#
# `start_scratch_server` sets scratch (/tmp/<prefix>.XXXXXX unless pre-set),
# port, base_url and server_pid; installs the EXIT/INT/TERM traps; and waits
# for this server's /api/_health. Extra NAME=value args are the only env the
# server adds on top of its fixed scratch set (e.g. EBOOK_LIBRARY_PATH) --
# the developer's env is scrubbed first. The scratch dir is kept iff the
# caller's `$status` is non-zero at exit (status starts at 1); INT/TERM exit
# 130.

label="${label:-scratch-server}"
HEALTH_TIMEOUT_SECS=120

bundle_web_app() {
    : "${CARGO_TARGET_DIR:?run this through \`just e2e-ci\` / \`just koreader-e2e\`, inside the nix dev shell}"
    profile_args=()
    bundle_dir="$CARGO_TARGET_DIR/e2e-ci/bundle"
    if [ "${OMNIBUS_E2E_RELEASE:-}" = 1 ]; then
        profile_args=(--release)
        bundle_dir="$CARGO_TARGET_DIR/e2e-ci/bundle-release"
    fi
    # A relative CARGO_TARGET_DIR (CI pins ./target) would resolve inside $scratch.
    case "$bundle_dir" in /*) ;; *) bundle_dir="$PWD/$bundle_dir" ;; esac

    echo "$label: bundling the web app (${profile_args[*]:-debug})" >&2
    dx bundle --platform web --package omnibus --fullstack --debug-symbols=false \
        ${profile_args[@]+"${profile_args[@]}"} --out-dir "$bundle_dir"
}

start_scratch_server() {
    local prefix="$1"
    shift

    # Not under $TMPDIR: the nix shell points that at a fresh dir per invocation.
    # Canonical (/tmp is /private/tmp on macOS) because the health wait compares
    # it with the cwd the server reports. Two steps, so a failed mktemp aborts
    # under set -e rather than leaving `cd ""` to make the worktree the scratch
    # dir. A caller that seeded a scratch dir of its own passes it in `scratch`.
    if [ -z "${scratch:-}" ]; then
        scratch="$(mktemp -d "/tmp/${prefix}.XXXXXX")"
    fi
    scratch="$(cd "$scratch" && pwd -P)"
    server_pid=""
    status=1

    # Invoked via `trap`, which shellcheck can't see.
    # shellcheck disable=SC2329
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
            echo "$label: kept $scratch" >&2
        fi
    }
    trap cleanup EXIT
    trap 'exit 130' INT TERM

    local choice
    if ! choice="$(choose_port --free-only)"; then
        echo "$label: no free port in $START_PORT-$END_PORT" >&2
        exit 1
    fi
    port="${choice%%:*}"
    base_url="http://127.0.0.1:$port"

    # The server must not see the developer's .env: library paths would index
    # a second library, provider keys and SMTP would reach the network, and
    # the dev rate-limit switch would hide limits CI enforces. Drop all of it,
    # then set exactly what CI's server has (plus the caller's extras).
    local unset_args=()
    local name
    for name in ${!OMNIBUS_@} ${!SMTP_@} EBOOK_LIBRARY_PATH AUDIOBOOK_LIBRARY_PATH \
        HARDCOVER_API_KEY GOOGLE_BOOKS_API_KEY DATABASE_URL RUST_LOG; do
        unset_args+=(-u "$name")
    done

    # The scratch dir is also the server's working directory: /api/_health
    # reports it as `repo_root`, so `just dev-up` walks past this server
    # instead of adopting it as the worktree's dev server.
    mkdir -p "$scratch/data"
    (
        cd "$scratch" || exit 1
        exec env ${unset_args[@]+"${unset_args[@]}"} \
            IP=127.0.0.1 PORT="$port" \
            DATABASE_URL="sqlite://$scratch/e2e.db?mode=rwc" \
            OMNIBUS_DATA_DIR="$scratch/data" \
            OMNIBUS_COVERS_DIR="$scratch/covers" \
            OMNIBUS_THUMBS_DIR="$scratch/thumbs" \
            OMNIBUS_PUBLIC_ORIGIN="$base_url,http://localhost:$port" \
            "$@" \
            "$bundle_dir/server"
    ) >"$scratch/server.log" 2>&1 &
    server_pid=$!

    # Wait for *this* server: a concurrent run can pick the same free port,
    # and the run whose server lost the bind would otherwise test the winner's.
    # Read by dev-port.sh's is_my_omnibus_response via the caller's source.
    # shellcheck disable=SC2034
    MY_REPO_ROOT="$scratch"
    echo "$label: waiting for $base_url/api/_health (log: $scratch/server.log)" >&2
    local deadline
    deadline=$(($(date +%s) + HEALTH_TIMEOUT_SECS))
    until kill -0 "$server_pid" 2>/dev/null &&
        is_my_omnibus_response "$(probe_health "$port")"; do
        if ! kill -0 "$server_pid" 2>/dev/null || [ "$(date +%s)" -ge "$deadline" ]; then
            echo "$label: the server never became healthy — end of its log:" >&2
            tail -n 30 "$scratch/server.log" >&2
            exit 1
        fi
        sleep 0.5
    done
}
