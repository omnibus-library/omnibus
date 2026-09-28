#!/usr/bin/env python3
"""Tests for the journal readers a runner resumes and briefs from.

    python3 scripts/explore/tests/test_ledger.py

`journal.py open-flows` is what a resumed subagent is briefed from after a
rate limit, and `owned.sh` is both the ownership ledger the guard asks and the
list of corpus files already used. Both are driven as the runner drives them,
over a journal written to a temp dir.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

EXPLORE = Path(__file__).resolve().parents[1]
RUN = "r-20260101-01"
UUID_A = "aaaaaaaa-0000-4000-8000-000000000001"
UUID_C = "cccccccc-0000-4000-8000-000000000003"


def entry(actor, seq, action, flow=None, target=None, outcome="ok", **params):
    return {"run": RUN, "actor": actor, "seq": seq, "action": action, "flow": flow,
            "target": target, "outcome": outcome, "params": params}


class LedgerTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def write(self, *entries):
        path = self.root / RUN / "journal.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(e) + "\n" for e in entries))

    def run_tool(self, *argv):
        env = {**os.environ, "OMNIBUS_EXPLORE_JOURNAL_DIR": str(self.root)}
        return subprocess.run([str(a) for a in argv], capture_output=True, text=True, check=True, env=env).stdout


class OpenFlowsTests(LedgerTestCase):
    def open_flows(self):
        return json.loads(self.run_tool(sys.executable, EXPLORE / "journal.py",
                                        "--journal-dir", self.root, "open-flows", "--run", RUN))

    def test_open_flows_lists_a_parent_and_subflow_started_and_never_ended(self):
        self.write(
            entry("agent-1", 1, "flow.start", "reading_a_book"),
            entry("agent-1", 2, "flow.start", "adding_highlight"),
            entry("agent-1", 3, "highlight.create", "adding_highlight", UUID_A, "uncertain"),
        )
        got = self.open_flows()["agent-1"]
        self.assertEqual(got["open"], [{"flow": "reading_a_book", "started_seq": 1},
                                       {"flow": "adding_highlight", "started_seq": 2}])
        self.assertEqual(got["last_seq"], 3)
        self.assertEqual(got["last"]["action"], "highlight.create")
        self.assertEqual(got["last"]["outcome"], "uncertain")

    def test_open_flows_reports_an_actor_whose_flows_all_ended_as_having_none_open(self):
        self.write(
            entry("agent-1", 1, "flow.start", "wishlist"),
            entry("agent-1", 2, "flow.end", "wishlist", verdict="pass"),
            entry("agent-2", 1, "flow.start", "viewing_stats"),
        )
        got = self.open_flows()
        self.assertEqual(got["agent-1"]["open"], [])
        self.assertEqual(got["agent-2"]["open"], [{"flow": "viewing_stats", "started_seq": 1}])


class OwnedTests(LedgerTestCase):
    def setUp(self):
        super().setUp()
        self.write(
            entry("agent-1", 1, "book.add", "adding_book", UUID_A, source_filename="a.epub"),
            # An upload that crashed before producing a book neither owns
            # anything nor retires its file.
            entry("agent-1", 2, "book.add", "adding_book", None, "ok", source_filename="b.m4b"),
            entry("agent-1", 3, "book.add", "adding_book", None, "error", source_filename="d.epub"),
            entry("agent-2", 1, "book.add", "adding_book", UUID_C, filename="c.epub"),
        )

    def owned(self, *args):
        return self.run_tool(EXPLORE / "owned.sh", *args).strip()

    def test_owned_prints_the_uuids_an_actor_added(self):
        self.assertEqual(self.owned("agent-1"), UUID_A)

    def test_owned_files_lists_one_actors_used_corpus_files_excluding_adds_with_no_book(self):
        self.assertEqual(self.owned("--files", "agent-1").splitlines(), ["a.epub"])

    def test_owned_files_all_lists_every_actors_used_corpus_files(self):
        self.assertEqual(self.owned("--files", "all").splitlines(), ["a.epub", "c.epub"])


if __name__ == "__main__":
    unittest.main()
