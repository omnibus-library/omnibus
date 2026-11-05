#!/usr/bin/env bash
# Tests for scripts/check-migration-numbers.sh — the check that a branch's new
# migrations are numbered above everything its base already holds.
#
# Each case builds a throwaway git repo: a `main` with migrations, and a
# branch cut from it, so the real script runs against real refs.
#
# Usage: scripts/tests/check-migration-numbers.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
script="$repo_root/scripts/check-migration-numbers.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

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

# A repo whose main holds 0001 and 0002, checked out on a branch cut from it.
fresh_repo() {
    local dir="$work/$1"
    git init -q -b main "$dir"
    cd "$dir"
    git config user.email test@example.com
    git config user.name test
    # Keep the machine-wide hooks (commit-msg, secret scan) out of the scratch repo.
    git config core.hooksPath /dev/null
    mkdir -p db/migrations
    touch db/migrations/0001_initial.sql db/migrations/0002_second.sql
    git add . && git commit -qm base
    git switch -qc feature
}

add_migration() {
    touch "db/migrations/$1"
    git add . && git commit -qm "$1"
}

# Main gains 0003 after the branch adds its own 0003.
fresh_repo collides
add_migration 0003_from_branch.sql
git switch -q main && add_migration 0003_from_main.sql && git switch -q feature
status=0
output="$("$script" main 2>&1)" || status=$?
check "a branch migration numbered at the base's highest fails" 1 "$status"
check "the failure names the colliding file" yes \
    "$(grep -q 'db/migrations/0003_from_branch.sql' <<<"$output" && echo yes || echo no)"
check "the failure names the next free number" yes \
    "$(grep -q '0004' <<<"$output" && echo yes || echo no)"

fresh_repo higher
add_migration 0003_new.sql
status=0
"$script" main >/dev/null 2>&1 || status=$?
check "a branch migration numbered above the base passes" 0 "$status"

fresh_repo none
touch notes.txt && git add . && git commit -qm notes
status=0
"$script" main >/dev/null 2>&1 || status=$?
check "a branch with no new migrations passes" 0 "$status"

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
