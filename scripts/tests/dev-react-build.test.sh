#!/usr/bin/env bash
# Tests for ensure_react_build() in scripts/lib/dev-port.sh — the dev-up
# build that must never leave the running server without a client: the
# build lands beside dist and replaces it only once it has succeeded.
#
# The real library is sourced; only `pnpm` is stubbed, so no node is needed.
#
# Usage: scripts/tests/dev-react-build.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
PORT=3000 source "$repo_root/scripts/lib/dev-port.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
mkdir -p frontend-js/src openapi
touch frontend-js/index.html frontend-js/package.json frontend-js/pnpm-lock.yaml \
    frontend-js/vite.config.ts openapi/openapi.json
REACT_DIST="$work/frontend-js/dist"

# Stands in for `vite build`, which empties its output directory (dist unless
# --outDir names another) before it writes anything.
pnpm() {
    case " $* " in *" install "*) return 0 ;; esac
    local out="$REACT_DIST"
    while [ $# -gt 0 ]; do
        [ "$1" = --outDir ] && out="$2"
        shift
    done
    rm -rf "$out"
    mkdir -p "$out"
    [ "${BUILD_FAILS:-}" = 1 ] && return 1
    echo "fresh" >"$out/index.html"
}

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

mkdir -p "$REACT_DIST"
echo "old" >"$REACT_DIST/index.html"
touch -d "1 hour ago" "$REACT_DIST/index.html"
touch frontend-js/src/app.tsx

BUILD_FAILS=1 ensure_react_build 2>/dev/null || true
check "a failed build leaves the served dist untouched" "old" "$(cat "$REACT_DIST/index.html")"
check "a failed build leaves no half-built directory" "dist" "$(ls frontend-js | grep '^dist' | tr '\n' ' ' | sed 's/ $//')"

ensure_react_build 2>/dev/null
check "a good build replaces dist" "fresh" "$(cat "$REACT_DIST/index.html")"
check "a good build leaves nothing beside dist" "dist" "$(ls frontend-js | grep '^dist' | tr '\n' ' ' | sed 's/ $//')"

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
