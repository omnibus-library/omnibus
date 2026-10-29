#!/usr/bin/env bash
# Stop THIS workspace's dev server. Identity-checked: refuses to kill a
# PID whose /api/_health reports a different repo_root (i.e. a sibling
# worktree's server bound to a port we wrote to our PID file by
# accident, or anything else not ours).
#
# Exits:
#   0 — stopped (or already stopped). Emits OMNIBUS_DEV_READY action=stopped
#       on stdout when an actual kill happened.
#   2 — PID file points at a server whose repo_root != ours. Refused.
#   3 — PID is live but ps can't name it, so it can't be checked. Refused.

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# MY_REPO_ROOT, RUNTIME_DIR and stop_process_tree come from here; dev-up's
# failure path stops a server the same way.
# shellcheck source=scripts/lib/dev-port.sh
source scripts/lib/dev-port.sh

if [ ! -f "$RUNTIME_DIR/server.pid" ]; then
    echo "dev-down: no server.pid; nothing to stop." >&2
    exit 0
fi

pid="$(cat "$RUNTIME_DIR/server.pid" 2>/dev/null || true)"
port="$(cat "$RUNTIME_DIR/port" 2>/dev/null || true)"

clean_stale() {
    echo "dev-down: PID ${pid:-<empty>} is not a running dx; cleaning stale runtime files." >&2
    rm -f "$RUNTIME_DIR/server.pid" "$RUNTIME_DIR/port" "$RUNTIME_DIR/env.sh"
    exit 0
}

# A PID file outlives the dx it named, and once the PID is reused the port
# is silent and the identity check below passes: anything not dx is stale.
if [ -z "$pid" ] || ! proc_is_live "$pid"; then
    clean_stale
fi
name="$(proc_name "$pid")"
if [ -z "$name" ]; then
    # Live but unnamed means ps can't answer, not that the PID is stale:
    # dropping the files would orphan a server that may still be ours.
    proc_is_live "$pid" || clean_stale
    echo "dev-down: pid $pid is running but ps can't name it; left it and the runtime files alone. Stop it by hand if it is this worktree's dx." >&2
    exit 3
fi
is_dx_name "$name" || clean_stale

# Identity check via /api/_health.repo_root. If the server doesn't
# respond, we have a wedged process — still ours by PID file, kill it.
# If it responds with a different repo_root, REFUSE — that's a sibling
# workspace's server and we must not touch it.
body=""
if [ -n "$port" ]; then
    body="$(curl --silent --show-error --max-time 2 --connect-timeout 1 \
        "http://127.0.0.1:${port}/api/_health" 2>/dev/null || true)"
fi
server_root="$(echo "$body" | sed -nE 's/.*"repo_root"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p')"
if [ -n "$server_root" ] && [ "$server_root" != "$MY_REPO_ROOT" ]; then
    echo "dev-down: PID $pid on port $port serves $server_root, not $MY_REPO_ROOT — refusing to kill a sibling workspace's server." >&2
    exit 2
fi

# Either ours by repo_root match, or wedged (no response) but recorded
# in our PID file — either way, kill it.
echo "dev-down: stopping pid $pid (port ${port:-?})" >&2
stop_process_tree "$pid"

rm -f "$RUNTIME_DIR/server.pid" "$RUNTIME_DIR/port" "$RUNTIME_DIR/env.sh"

echo "OMNIBUS_DEV_READY port=${port:-} repo_root=$MY_REPO_ROOT action=stopped"
