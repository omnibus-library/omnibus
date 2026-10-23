#!/usr/bin/env bash
# Tests for make_scratch_dir() in scripts/lib/scratch-server.sh — the scratch
# dir every E2E lane runs in and tears down.
#
# The helper must own the dir from creation on: it never adopts an exported
# `scratch` (a caller's pre-made dir would otherwise get another owner's
# teardown), and it installs the EXIT/INT/TERM traps before anything can fail.
#
# No network, no dx: the real library is sourced and only its I/O helpers are
# stubbed, as in dev-port-choose-port.test.sh.
#
# Usage: scripts/tests/scratch-server-make-scratch-dir.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

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

d="$(mktemp -d)"
trap 'rm -rf "$d"' EXIT
mkdir -p "$d/keep"
touch "$d/keep/precious"

# An exported scratch that must survive: the helper has to make its own dir.
scratch="$d/keep" bash -c '
    set -euo pipefail
    source scripts/lib/dev-port.sh
    source scripts/lib/scratch-server.sh
    label=e2e-ci
    make_scratch_dir
    echo "SCRATCH=$scratch"
    status=0
' >"$d/out" 2>"$d/err" || true

fresh="$(sed -n 's/^SCRATCH=//p' "$d/out")"

shape="<none>"
if [ -n "$fresh" ]; then
    if [ "$fresh" = "$d/keep" ]; then
        shape="adopted"
    else
        case "$fresh" in
            /tmp/omnibus-e2e-ci.*) shape="fresh" ;;
            *) shape="$fresh" ;;
        esac
    fi
fi

check "exported scratch dir is left alone" "precious" "$(ls "$d/keep")"
check "scratch dir is a fresh /tmp/omnibus-<label>.* one" "fresh" "$shape"
check "fresh scratch dir is removed on a clean exit" \
    "gone" "$([ -n "$fresh" ] && [ ! -e "$fresh" ] && echo gone || echo present)"

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
