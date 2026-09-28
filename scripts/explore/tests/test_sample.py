#!/usr/bin/env python3
"""Tests for the flow sampler.

Run them directly — the workspace's `just test` covers the Rust crates and there
is no Python lane:

    python3 scripts/explore/tests/test_sample.py
    python3 -m unittest discover -s scripts/explore/tests

Most cases draw from a small synthetic catalog written to a temp dir, so a
catalog edit cannot move them; one case pins the real catalog.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SAMPLE = HERE.parent / "sample.py"

BOTH = "web, iOS"
WEB = "web"

# (name, runs, drawn after, surfaces) — the shape of the real catalog in miniature.
FLOWS = [
    ("reading", "on its own", "—", BOTH),
    ("highlight", "inside reading", "—", BOTH),
    ("listening", "on its own", "—", BOTH),
    ("stats", "on its own", "reading, listening", BOTH),
    ("browsing", "on its own", "—", BOTH),
    ("editing", "inside browsing", "—", BOTH),
    ("journal", "inside browsing", "—", WEB),
    ("adding_book", "on its own", "—", WEB),
    ("merging", "inside adding_book", "—", WEB),
    ("shelf", "on its own", "—", "web (create, select), iOS (create, fill)"),
]
TOP = [f[0] for f in FLOWS if f[1] == "on its own"]
IOS_TOP = [f[0] for f in FLOWS if f[1] == "on its own" and "iOS" in f[3]]


def write_catalog(root: Path, flows=FLOWS, skip_doc=(), no_surfaces=()) -> Path:
    rows = "\n".join(
        f"| [{name}]({name}.md) | {runs} | no | {after} |"
        for name, runs, after, _ in flows
    )
    readme = root / "README.md"
    readme.write_text(
        "# Flow catalog\n\n"
        "| Flow | Runs | Owner-only | Drawn after |\n"
        "|---|---|---|---|\n"
        f"{rows}\n"
    )
    for name, runs, _, surfaces in flows:
        if name in skip_doc:
            continue
        header = ["| | |", "|---|---|", f"| **Runs** | {runs} |"]
        if name not in no_surfaces:
            header.append(f"| **Surfaces** | {surfaces} |")
        (root / f"{name}.md").write_text(f"# {name}\n\n" + "\n".join(header) + "\n")
    return readme


def run(catalog: Path | None, *args: str) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(SAMPLE), "--run", "r-test", *args]
    if catalog is not None:
        cmd += ["--catalog", str(catalog)]
    return subprocess.run(cmd, capture_output=True, text=True)


def draw(catalog: Path | None, *args: str) -> dict:
    proc = run(catalog, *args)
    if proc.returncode != 0:
        raise AssertionError(f"sample.py exited {proc.returncode}: {proc.stderr}")
    return json.loads(proc.stdout)


def flows_of(agent: dict) -> list[str]:
    return [step["flow"] for step in agent["sequence"]]


def subflows_of(agent: dict, parent: str) -> list[str] | None:
    for step in agent["sequence"]:
        if step["flow"] == parent:
            return step["subflows"]
    return None


class CatalogTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.catalog = write_catalog(self.root)

    def tearDown(self):
        self._tmp.cleanup()

    def assertFails(self, proc: subprocess.CompletedProcess, *needles: str):
        # 1 is sys.exit(msg); argparse rejecting an unknown option exits 2.
        self.assertEqual(proc.returncode, 1, proc.stderr or proc.stdout)
        for needle in needles:
            self.assertIn(needle, proc.stderr)


class ExcludeTests(CatalogTestCase):
    def test_exclude_drops_a_subflow_from_every_agent_and_reports_it(self):
        out = draw(self.catalog, "--agents", "3", "--flows-per-agent", str(len(TOP)),
                   "--seed", "1", "--exclude", "editing")
        self.assertEqual(out["excluded"], ["editing"])
        for agent in out["agents"]:
            self.assertEqual(subflows_of(agent, "browsing"), ["journal"])

    def test_exclude_drops_a_top_level_flow_and_reports_it(self):
        out = draw(self.catalog, "--agents", "2", "--flows-per-agent", str(len(TOP) - 1),
                   "--seed", "1", "--exclude", "shelf")
        self.assertEqual(out["excluded"], ["shelf"])
        for agent in out["agents"]:
            self.assertNotIn("shelf", flows_of(agent))

    def test_exclude_exits_non_zero_on_a_name_the_catalog_does_not_know(self):
        self.assertFails(run(self.catalog, "--exclude", "editng"), "editng")

    def test_a_run_with_no_exclusions_reports_empty_exclusions(self):
        out = draw(self.catalog, "--seed", "1")
        self.assertEqual(out["excluded"], [])
        for agent in out["agents"]:
            self.assertEqual(agent["excluded"], {})
            self.assertEqual(agent["surface"], "web")


class ExcludeForTests(CatalogTestCase):
    def test_exclude_for_drops_a_flow_for_one_agent_only_and_reports_why(self):
        out = draw(self.catalog, "--agents", "2", "--flows-per-agent", str(len(TOP)),
                   "--seed", "1", "--exclude-for", "agent-1=merging")
        one, two = out["agents"]
        self.assertEqual(subflows_of(one, "adding_book"), [])
        self.assertEqual(one["excluded"], {"merging": "--exclude-for"})
        self.assertEqual(subflows_of(two, "adding_book"), ["merging"])
        self.assertEqual(two["excluded"], {})
        self.assertEqual(out["excluded"], [])

    def test_exclude_for_is_repeatable_across_agents(self):
        out = draw(self.catalog, "--agents", "2", "--flows-per-agent", "4",
                   "--seed", "1", "--exclude-for", "agent-1=shelf",
                   "--exclude-for", "agent-2=stats,adding_book")
        one, two = out["agents"]
        self.assertNotIn("shelf", flows_of(one))
        self.assertEqual(one["excluded"], {"shelf": "--exclude-for"})
        self.assertEqual(two["excluded"], {"stats": "--exclude-for", "adding_book": "--exclude-for"})

    def test_exclude_for_exits_non_zero_on_an_actor_not_in_the_run(self):
        self.assertFails(run(self.catalog, "--agents", "2", "--exclude-for", "agent-3=stats"),
                         "agent-3")

    def test_exclude_for_exits_non_zero_on_a_flow_the_catalog_does_not_know(self):
        self.assertFails(run(self.catalog, "--exclude-for", "agent-1=stts"), "stts")

    def test_flows_per_agent_beyond_one_agents_pool_exits_naming_that_agent(self):
        proc = run(self.catalog, "--agents", "2", "--flows-per-agent", str(len(TOP)),
                   "--exclude-for", "agent-2=stats")
        self.assertFails(proc, "agent-2")


class IosTests(CatalogTestCase):
    def test_ios_adds_one_agent_after_the_web_agents_with_the_ios_surface(self):
        out = draw(self.catalog, "--agents", "2", "--seed", "1", "--ios")
        self.assertEqual([(a["actor"], a["surface"]) for a in out["agents"]],
                         [("agent-1", "web"), ("agent-2", "web"), ("agent-3", "ios")])

    def test_ios_agent_draws_only_flows_whose_doc_lists_ios_and_reports_the_rest(self):
        out = draw(self.catalog, "--agents", "1", "--flows-per-agent", str(len(IOS_TOP)),
                   "--seed", "1", "--ios")
        ios = out["agents"][-1]
        self.assertEqual(sorted(flows_of(ios)), sorted(IOS_TOP))
        self.assertEqual(subflows_of(ios, "browsing"), ["editing"])
        self.assertEqual(ios["excluded"], {"journal": "surface ios", "adding_book": "surface ios",
                                           "merging": "surface ios"})

    def test_ios_does_not_change_the_web_agents_draws_for_a_fixed_seed(self):
        for seed in range(10):
            args = ("--agents", "3", "--flows-per-agent", "3", "--seed", str(seed))
            without = draw(self.catalog, *args)["agents"]
            with_ios = draw(self.catalog, *args, "--ios")["agents"]
            self.assertEqual(with_ios[:3], without, f"seed {seed}")

    def test_ios_exits_naming_the_ios_agent_when_its_pool_is_smaller_than_flows_per_agent(self):
        proc = run(self.catalog, "--agents", "1", "--flows-per-agent", str(len(TOP)), "--ios")
        self.assertFails(proc, "agent-2")

    def test_exclude_for_accepts_the_ios_agent(self):
        out = draw(self.catalog, "--agents", "1", "--seed", "1", "--ios",
                   "--exclude-for", "agent-2=shelf")
        self.assertEqual(out["agents"][1]["excluded"]["shelf"], "--exclude-for")

    def test_library_empty_forces_adding_first_only_for_agents_that_can_draw_it(self):
        out = draw(self.catalog, "--agents", "1", "--flows-per-agent", "3",
                   "--seed", "1", "--ios", "--library-empty")
        web, ios = out["agents"]
        self.assertEqual(flows_of(web)[0], "adding_book")
        self.assertNotIn("adding_book", flows_of(ios))


class DrawnAfterTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        unordered = [(n, r, "—", s) for n, r, _, s in FLOWS]
        (self.root / "unordered").mkdir()
        self.unordered = write_catalog(self.root / "unordered", unordered)

    def test_drawn_after_moves_stats_only_when_drawn_before_reading_or_listening(self):
        moved = kept = 0
        for seed in range(20):
            args = ("--agents", "2", "--flows-per-agent", str(len(TOP)), "--seed", str(seed))
            ordered = draw(self.catalog, *args)["agents"]
            raw = draw(self.unordered, *args)["agents"]
            for agent, before in zip(ordered, raw):
                seq, was = flows_of(agent), flows_of(before)
                last = max(seq.index("reading"), seq.index("listening"))
                self.assertEqual([f for f in seq if f != "stats"], [f for f in was if f != "stats"])
                if was.index("stats") > max(was.index("reading"), was.index("listening")):
                    self.assertEqual(seq, was, f"seed {seed}: already-late stats moved")
                    kept += 1
                else:
                    self.assertEqual(seq.index("stats"), last + 1, f"seed {seed}: {seq}")
                    moved += 1
        self.assertGreater(moved, 0, "no draw put stats before reading or listening")
        self.assertGreater(kept, 0, "no draw put stats after reading and listening")

    def test_drawn_after_leaves_stats_in_place_when_no_listed_flow_was_drawn(self):
        for seed in range(10):
            args = ("--agents", "2", "--flows-per-agent", "4", "--seed", str(seed),
                    "--exclude", "reading,listening")
            self.assertEqual(draw(self.catalog, *args)["agents"],
                             draw(self.unordered, *args)["agents"])

    def test_drawn_after_exits_non_zero_on_a_flow_name_the_catalog_does_not_know(self):
        flows = [(n, r, "reading, lisening" if n == "stats" else a, s) for n, r, a, s in FLOWS]
        (self.root / "typo").mkdir()
        self.assertFails(run(write_catalog(self.root / "typo", flows)), "lisening")


class CatalogTests(CatalogTestCase):
    def test_catalog_exits_non_zero_when_a_linked_flow_doc_is_missing(self):
        (self.root / "missing").mkdir()
        catalog = write_catalog(self.root / "missing", skip_doc=("shelf",))
        self.assertFails(run(catalog), "shelf.md")

    def test_catalog_exits_non_zero_when_a_flow_doc_has_no_surfaces_row(self):
        (self.root / "bare").mkdir()
        catalog = write_catalog(self.root / "bare", no_surfaces=("editing",))
        self.assertFails(run(catalog), "editing", "Surfaces")

    def test_real_catalog_parses_and_keeps_the_ios_agent_off_the_web_only_flows(self):
        web_only = {"adding_book", "merging_books", "deleting_a_book"}
        for seed in range(10):
            out = draw(None, "--agents", "2", "--flows-per-agent", "4",
                       "--seed", str(seed), "--ios")
            ios = out["agents"][-1]
            self.assertEqual(ios["surface"], "ios")
            drawn = set(flows_of(ios)) | {s for step in ios["sequence"] for s in step["subflows"]}
            self.assertFalse(drawn & web_only, f"seed {seed}: {drawn & web_only}")
            self.assertEqual({k for k, v in ios["excluded"].items() if v == "surface ios"},
                             web_only)


if __name__ == "__main__":
    unittest.main(verbosity=2)
