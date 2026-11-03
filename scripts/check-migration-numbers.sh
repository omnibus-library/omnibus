#!/usr/bin/env bash
# Fails when a migration this branch adds is numbered at or below the highest
# migration on its base, which would collide once both land. Names the
# colliding files and the next free number.
#
# Usage: scripts/check-migration-numbers.sh [base-ref]   (default origin/main)
set -euo pipefail

base="${1:-origin/main}"
dir=db/migrations

if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
    echo "check-migration-numbers: no ref $base; run git fetch origin" >&2
    exit 2
fi

base_max="$(git ls-tree --name-only "$base" "$dir/" |
    sed -n 's|.*/\([0-9]\{4\}\)_[^/]*\.sql$|\1|p' | sort | tail -n 1)"
base_max=$((10#${base_max:-0}))

collisions=()
while IFS= read -r file; do
    number="$(basename "$file")"
    number="${number%%_*}"
    if ((10#$number <= base_max)); then
        collisions+=("$file")
    fi
done < <(git diff --name-only --diff-filter=A "$base...HEAD" -- "$dir/*.sql")

if [ "${#collisions[@]}" -gt 0 ]; then
    printf 'These migrations are numbered at or below %04d, the highest on %s:\n' "$base_max" "$base" >&2
    printf '  %s\n' "${collisions[@]}" >&2
    printf 'Renumber them from %04d, then refresh db/migrations.lock.\n' "$((base_max + 1))" >&2
    exit 1
fi
