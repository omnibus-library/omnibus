#!/usr/bin/env bash
# Tests for the OMNIBUS_REACT switch in docker/entrypoint.sh.
#
# Runs the real entrypoint with its root-only commands (groupmod, usermod,
# chown, gosu) stubbed on PATH. The gosu stub drops the user argument and runs
# the command, so `entrypoint.sh env` prints the environment the server boots with.
#
# Usage: scripts/tests/docker-entrypoint-react.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
stubs="$(mktemp -d)"
trap 'rm -rf "$stubs"' EXIT

for cmd in groupmod usermod chown; do
    printf '#!/bin/sh\nexit 0\n' > "$stubs/$cmd"
done
printf '#!/bin/sh\nshift\nexec "$@"\n' > "$stubs/gosu"
chmod +x "$stubs"/*

# The OMNIBUS_REACT_DIR the server would boot with, or "unset".
booted_react_dir() {
    env -u OMNIBUS_REACT -u OMNIBUS_REACT_DIR PATH="$stubs:$PATH" "$@" \
        sh "$repo_root/docker/entrypoint.sh" sh -c 'echo "${OMNIBUS_REACT_DIR-unset}"' \
        2>/dev/null | tail -n 1
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

check "serves the bundled react build when OMNIBUS_REACT is 1" \
    "/app/react" "$(booted_react_dir OMNIBUS_REACT=1)"
check "leaves react off when OMNIBUS_REACT is unset" \
    "unset" "$(booted_react_dir)"
check "leaves react off when OMNIBUS_REACT is any other value" \
    "unset" "$(booted_react_dir OMNIBUS_REACT=true)"
check "keeps an explicit OMNIBUS_REACT_DIR over OMNIBUS_REACT" \
    "/srv/my-build" "$(booted_react_dir OMNIBUS_REACT=1 OMNIBUS_REACT_DIR=/srv/my-build)"
check "keeps an explicitly empty OMNIBUS_REACT_DIR over OMNIBUS_REACT" \
    "" "$(booted_react_dir OMNIBUS_REACT=1 OMNIBUS_REACT_DIR=)"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
