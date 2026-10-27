#!/usr/bin/env bash
# Tests that scripts/dev-server-down.sh stops the whole process tree under
# the PID it recorded, not just that PID: dx runs the server as a child, and a
# child left running keeps serving after dev-down reports it stopped.
#
# No dx, no network: a bash tree shaped like dx's (a parent, a child, and a
# grandchild under a second child) stands in for the server, in a scratch git
# repo whose PID file points at it. With no port file the health check is
# skipped, which is the script's path for a server that doesn't answer.
#
# Usage: scripts/tests/dev-server-down.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
script="$repo_root/scripts/dev-server-down.sh"

tmp="$(mktemp -d)"
tree=""
cleanup() {
    # shellcheck disable=SC2086
    [ -z "$tree" ] || kill -9 $tree 2>/dev/null || true
    rm -rf "$tmp"
}
trap cleanup EXIT

git -C "$tmp" init --quiet
mkdir -p "$tmp/.claude/runtime"

descendants() {
    local kid
    for kid in $(pgrep -P "$1" 2>/dev/null || true); do
        echo "$kid"
        descendants "$kid"
    done
}

# Started from a subshell that exits at once, so the tree's parent is init,
# as dx's is once `just dev-up` returns, and nothing here is left to reap it.
(bash -c 'sleep 300 & bash -c "sleep 300 & wait" & wait' >/dev/null 2>&1 & echo $! >"$tmp/.claude/runtime/server.pid")
pid="$(cat "$tmp/.claude/runtime/server.pid")"

for _ in $(seq 1 50); do
    [ "$(descendants "$pid" | wc -l)" -ge 3 ] && break
    sleep 0.1
done
tree="$pid $(descendants "$pid" | tr '\n' ' ')"

pass=0
fail=0

check() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$actual" = "$expected" ]; then
        echo "PASS: $desc"
        pass=$((pass + 1))
    else
        echo "FAIL: $desc (expected $expected, got $actual)" >&2
        fail=$((fail + 1))
    fi
}

running() {
    local p n=0
    for p in $tree; do
        kill -0 "$p" 2>/dev/null && n=$((n + 1))
    done
    echo "$n"
}

check "the stand-in tree is running before dev-down" 4 "$(running)"

(cd "$tmp" && "$script" >/dev/null 2>&1)

# init reaps each process as it exits, which can lag the signal a little.
for _ in $(seq 1 20); do
    [ "$(running)" = 0 ] && break
    sleep 0.1
done
check "every process in the tree has exited" 0 "$(running)"
check "the PID file is removed" absent \
    "$([ -e "$tmp/.claude/runtime/server.pid" ] && echo present || echo absent)"

echo "dev-server-down: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
