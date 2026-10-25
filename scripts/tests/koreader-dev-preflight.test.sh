#!/usr/bin/env bash
# Tests for require_docker() and require_dev_server() in scripts/koreader-dev.sh
# — the two checks `just koreader` runs before it builds anything, so a missing
# Docker or dev server is one readable line, not a build failure.
#
# No Docker, no server: the real script is sourced (it does not run `main` when
# sourced) and only `docker` and `probe_health` are stubbed, as in
# scratch-server-make-scratch-dir.test.sh.
#
# Usage: scripts/tests/koreader-dev-preflight.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

# shellcheck source=scripts/koreader-dev.sh disable=SC1091
source scripts/koreader-dev.sh

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

# Runs "$@" in a subshell with stdout/stderr/status captured as one string.
run() {
    local out err status=0
    out="$(mktemp)"
    err="$(mktemp)"
    ("$@") >"$out" 2>"$err" || status=$?
    echo "$status|$(cat "$out")|$(cat "$err")"
    rm -f "$out" "$err"
}

docker_down_msg="koreader: Docker isn't reachable — start Docker (Docker Desktop on macOS) and retry"
no_server_msg='koreader: no dev server for this worktree — run `just dev-up` (or `just serve`) first'

docker() { echo arm64; }
check "require_docker prints the engine's arch" "0|arm64|" "$(run require_docker)"

docker() { return 1; }
check "require_docker fails readably when the daemon is down" "1||$docker_down_msg" "$(run require_docker)"

unset -f docker
without_docker() {
    PATH=/nonexistent
    require_docker
}
check "require_docker fails readably when docker is not installed" "1||$docker_down_msg" "$(run without_docker)"

runtime="$(mktemp -d)"
trap 'rm -rf "$runtime"' EXIT
RUNTIME_DIR="$runtime"

check "require_dev_server fails readably when no port file exists" "1||$no_server_msg" "$(run require_dev_server)"

echo 3571 >"$runtime/port"
probe_health() { echo '{"app":"omnibus","repo_root":"/somewhere/else"}'; }
check "require_dev_server fails readably when the port serves another worktree" \
    "1||$no_server_msg" "$(run require_dev_server)"

probe_health() { :; }
check "require_dev_server fails readably when nothing answers on the port" \
    "1||$no_server_msg" "$(run require_dev_server)"

probe_health() { echo "{\"app\":\"omnibus\",\"repo_root\":\"$MY_REPO_ROOT\"}"; }
check "require_dev_server prints the port when this worktree's server answers" \
    "0|3571|" "$(run require_dev_server)"

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
