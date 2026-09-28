"""What the audit reads in: the journal file, `.env`, and provisioned accounts."""

from __future__ import annotations

import json
import multiprocessing
import tempfile
import unittest
from pathlib import Path

from .. import env, journal
from ..client import ApiError, load_accounts
from .support import entry


def _append_many(path: str, actor: str, count: int) -> None:
    """Worker for the concurrency test — one process per actor."""
    for i in range(count):
        journal.append(path, {"actor": actor, "action": "note", "params": {"i": i, "pad": "x" * 4000}})


class JournalTests(unittest.TestCase):
    def test_iter_entries_fails_loudly_on_a_torn_line(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "journal.jsonl"
            p.write_text('{"actor":"a","seq":1}\n{"actor":"b",\n', encoding="utf-8")
            with self.assertRaises(journal.JournalError):
                journal.read_entries(p)

    def test_actor_entries_orders_by_seq_not_by_file_order(self) -> None:
        entries = [entry("note", actor="a", seq=3), entry("note", actor="b", seq=1), entry("note", actor="a", seq=1)]
        self.assertEqual([e.seq for e in journal.actor_entries(entries, "a")], [1, 3])

    def test_append_mints_a_monotonic_seq_per_actor(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "journal.jsonl"
            self.assertEqual(journal.append(p, {"actor": "agent-1", "action": "note"})["seq"], 1)
            self.assertEqual(journal.append(p, {"actor": "agent-2", "action": "note"})["seq"], 1)
            self.assertEqual(journal.append(p, {"actor": "agent-1", "action": "note"})["seq"], 2)

    def test_concurrent_appends_never_interleave_or_truncate(self) -> None:
        """AC1: three agents, one file, oversized records, no torn lines."""
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "journal.jsonl"
            p.touch()
            ctx = multiprocessing.get_context("spawn")
            procs = [ctx.Process(target=_append_many, args=(str(p), f"agent-{n}", 40)) for n in (1, 2, 3)]
            for proc in procs:
                proc.start()
            for proc in procs:
                proc.join(120)
                self.assertEqual(proc.exitcode, 0)

            lines = [ln for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]
            self.assertEqual(len(lines), 120)
            for line in lines:
                json.loads(line)  # raises if a record was split or spliced
            entries = journal.read_entries(p)
            for actor in ("agent-1", "agent-2", "agent-3"):
                seqs = sorted(e.seq for e in entries if e.actor == actor)
                self.assertEqual(seqs, list(range(1, 41)), f"{actor} lost or repeated a seq")

    def test_journal_path_rejects_an_implausible_run_id(self) -> None:
        with self.assertRaises(journal.JournalError):
            journal.journal_path("../../etc", "/tmp")


class EnvTests(unittest.TestCase):
    def test_parse_reads_only_the_exploration_keys(self) -> None:
        got = env.parse("HARDCOVER_API_KEY=secret\nOMNIBUS_EXPLORE_URL=https://x\n# comment\n")
        self.assertEqual(got, {"OMNIBUS_EXPLORE_URL": "https://x"})

    def test_parse_expands_the_home_form_env_example_recommends(self) -> None:
        got = env.parse("OMNIBUS_EXPLORE_JOURNAL_DIR=$HOME/.omnibus-explore/journals\n")
        self.assertTrue(got["OMNIBUS_EXPLORE_JOURNAL_DIR"].endswith("/.omnibus-explore/journals"))
        self.assertNotIn("$HOME", got["OMNIBUS_EXPLORE_JOURNAL_DIR"])

    def test_parse_strips_surrounding_quotes(self) -> None:
        self.assertEqual(env.parse('OMNIBUS_EXPLORE_URL="https://x"\n')["OMNIBUS_EXPLORE_URL"], "https://x")

    def test_load_never_clobbers_an_exported_value(self) -> None:
        existing = {"OMNIBUS_EXPLORE_URL": "https://already-set"}
        env.load(existing)
        self.assertEqual(existing["OMNIBUS_EXPLORE_URL"], "https://already-set")


class AccountTests(unittest.TestCase):
    def test_load_accounts_reads_provision_output(self) -> None:
        raw = [{"actor": "agent-1", "username": "explorer-1", "password": "p", "action": "reused"}]
        self.assertEqual(load_accounts(raw)["agent-1"].username, "explorer-1")

    def test_load_accounts_rejects_a_row_missing_a_field(self) -> None:
        with self.assertRaises(ApiError):
            load_accounts([{"actor": "agent-1"}])
