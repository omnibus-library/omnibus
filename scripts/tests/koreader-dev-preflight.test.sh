#!/usr/bin/env bash
# Tests for scripts/koreader-dev.sh: require_docker() and require_dev_server(),
# the checks `just koreader` runs before it builds anything (a missing Docker or
# dev server is one readable line), the networking it picks from the engine,
# its usage line, and the KOReader pin file.
#
# No Docker, no server: the real script is sourced (it does not run `main` when
# sourced) and only `docker`, `uname` and `probe_health` are stubbed, as in
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

uname() { echo Linux; }
docker() { echo 'Arch Linux|["name=seccomp,profile=builtin","name=cgroupns"]'; }
check "docker_network_mode shares the host's network on a native rootful Linux engine" \
    "0|host|" "$(run docker_network_mode)"

docker() { echo 'Arch Linux|["name=seccomp,profile=builtin","name=rootless","name=cgroupns"]'; }
check "docker_network_mode publishes ports on a rootless Linux engine" \
    "0|published|" "$(run docker_network_mode)"

docker() { echo 'Docker Desktop|["name=seccomp,profile=unconfined","name=cgroupns"]'; }
check "docker_network_mode publishes ports on Docker Desktop for Linux" \
    "0|published|" "$(run docker_network_mode)"

uname() { echo Darwin; }
docker() { echo 'Docker Desktop|["name=seccomp,profile=unconfined"]'; }
check "docker_network_mode publishes ports on macOS" "0|published|" "$(run docker_network_mode)"
unset -f uname

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

usage_msg="koreader: usage: just koreader [--home DIR]"
check "main rejects an unknown argument with the usage line" "2||$usage_msg" "$(run main --bogus)"
check "main rejects --home without a directory with the usage line" "2||$usage_msg" "$(run main --home)"

pin_versions="$(sed -E 's/.*koreader_([^_]*-1)_.*/\1/' ui_tests/koreader/koreader.sha256 | sort -u | wc -l)"
check "every arch's KOReader pin names the same version" "1" "$((pin_versions))"

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
