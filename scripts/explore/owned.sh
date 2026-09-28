#!/usr/bin/env bash
# Print the uuids an actor owns, comma-separated — what the ownership guard
# asks on every destructive call.
#
# Ownership is provenance: you own a book if you added it, in *any* run. So
# this reads every journal, not just the current one — which is also why the
# exploration accounts keep stable usernames (see provision.sh).
#
# Usage: owned.sh <actor>            e.g. owned.sh agent-1
#        owned.sh --files <actor|all>
#                                    the corpus files those adds came from, one
#                                    per line: what adding_book.md must not
#                                    hand out again

set -euo pipefail
usage="usage: owned.sh <actor> | owned.sh --files <actor|all>"
mode=uuids
if [ "${1-}" = "--files" ]; then mode=files; shift; fi
actor="${1:?$usage}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"

# The journal is the ownership ledger, so it must outlive any one checkout.
# `.claude/runtime/` is gitignored and therefore *per-worktree*: leaving the
# journals there means a `wt switch` silently orphans every book previously
# uploaded, because no `book.add` entry can be found for them any more. Pin
# OMNIBUS_EXPLORE_JOURNAL_DIR (see .env.example) to somewhere outside the
# worktrees; the in-repo path remains the fallback for a single checkout.
if [ -z "${OMNIBUS_EXPLORE_JOURNAL_DIR-}" ] && [ -f "$ROOT/.env" ]; then
  raw="$(grep -E '^OMNIBUS_EXPLORE_JOURNAL_DIR=' "$ROOT/.env" | tail -1 | cut -d= -f2- || true)"
  # .env values are literal text: strip surrounding quotes and expand $VARS and
  # a leading ~ ourselves. Without this, the `$HOME/...` form .env.example
  # recommends resolves to a directory that does not exist, owned.sh returns an
  # empty list, and the guard then refuses an agent's own books.
  raw="${raw%\"}"; raw="${raw#\"}"; raw="${raw%\'}"; raw="${raw#\'}"
  raw="${raw/#\~/$HOME}"
  OMNIBUS_EXPLORE_JOURNAL_DIR="$(eval printf '%s' "\"$raw\"")"
fi
JOURNALS="${OMNIBUS_EXPLORE_JOURNAL_DIR:-$ROOT/.claude/runtime/explore}"

python3 - "$mode" "$actor" "$JOURNALS" <<'PY'
import json, pathlib, sys

mode, actor, root = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3])
owned = []
for journal in sorted(root.glob("*/journal.jsonl")):
    with journal.open() as fh:
      for line in fh:                      # stream: a long run's journal is large
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            # A torn line is not a reason to hand back a shorter ownership
            # list — that would silently un-own a book. Fail loudly instead.
            sys.exit(f"unparseable journal line in {journal}: {line[:80]}")
        # Require a target: a `book.add` whose upload never produced a book
        # (r-20260829-01's crashed audiobook) neither owns anything nor
        # retires its file.
        if e.get("action") != "book.add" or e.get("outcome") != "ok" or not e.get("target"):
            continue
        if mode == "uuids" and e.get("actor") == actor:
            owned.append(e["target"])
        elif mode == "files" and actor in ("all", e.get("actor")):
            p = e.get("params") or {}
            owned.append(p.get("source_filename") or p.get("filename") or p.get("file") or "?")
if mode == "files":
    print("\n".join(dict.fromkeys(owned)))
else:
    print(",".join(dict.fromkeys(owned)))
PY
