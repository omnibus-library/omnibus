#!/usr/bin/env bash
# Foreground React dev server for the `react` pane of `just serve` /
# `just serve-pc`, and for `just react`.
#
# Waits for THIS worktree's omnibus server (the `server` pane publishes its
# port to .claude/runtime/port), then runs Vite on the port that pane
# reserved for it (.claude/runtime/react-port), proxying /api to the server.
# Both clients then talk to one backend, one database and one session.
# Ctrl-C stops it.
#
# Override the bind address with OMNIBUS_DEV_ADDR, as for the server pane.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# shellcheck source=scripts/lib/dev-port.sh
source scripts/lib/dev-port.sh

echo "react: waiting for this worktree's server (start the server pane first)" >&2
until [ -f "$RUNTIME_DIR/port" ] &&
    is_my_omnibus_response "$(probe_health "$(cat "$RUNTIME_DIR/port")")"; do
    sleep 2
done
api_port="$(cat "$RUNTIME_DIR/port")"

if [ -f "$RUNTIME_DIR/react-port" ]; then
    react_port="$(cat "$RUNTIME_DIR/react-port")"
elif react_port="$(choose_react_port "$api_port")"; then
    # A server started by `just dev-up` reserves no port, so its origin
    # allowlist lacks this one: cookie-authed POSTs (sign out) answer 403.
    echo "react: the server reserved no port; sign-out and other POSTs may 403" >&2
else
    echo "react: no free port above $api_port in $START_PORT-$END_PORT." >&2
    exit 1
fi

cd frontend-js
pnpm install --frozen-lockfile --prefer-offline
echo "react: http://localhost:$react_port, proxying /api to :$api_port" >&2
export OMNIBUS_PORT="$api_port"
exec pnpm exec vite --port "$react_port" --strictPort \
    --host "${OMNIBUS_DEV_ADDR:-0.0.0.0}"
