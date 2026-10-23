#!/usr/bin/env python3
"""Tests for scripts/koreader_report.py, the KOReader lane's per-scenario
PASS/FAIL report.

    python3 scripts/tests/koreader-report.test.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from koreader_report import summarize  # noqa: E402


class SummarizeTests(unittest.TestCase):
    def setUp(self):
        self.results = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.results, True)

    def write_result(self, payload: object) -> Path:
        path = self.results / "opds.json"
        path.write_text(payload if isinstance(payload, str) else json.dumps(payload))
        return path

    def test_passes_scenario_when_every_step_is_ok(self):
        self.write_result(
            {
                "scenario": "opds",
                "steps": [
                    {"name": "add_catalog", "ok": True, "detail": "catalog added"},
                    {"name": "open", "ok": True, "detail": "pages=3"},
                ],
            }
        )
        self.assertEqual(summarize(self.results, "opds"), (True, "PASS opds"))

    def test_fails_naming_the_first_failed_step(self):
        self.write_result(
            {
                "scenario": "opds",
                "steps": [
                    {"name": "add_catalog", "ok": True, "detail": "catalog added"},
                    {
                        "name": "search",
                        "ok": False,
                        "detail": 'expected "Alpha" in search results, got ["Beta in the Series"]',
                    },
                    {"name": "download", "ok": False, "detail": "unreached"},
                ],
            }
        )
        self.assertEqual(
            summarize(self.results, "opds"),
            (
                False,
                "FAIL opds: search: expected \"Alpha\" in search results, "
                'got ["Beta in the Series"]',
            ),
        )

    def test_fails_appending_the_screenshot_when_one_was_taken(self):
        self.write_result(
            {
                "scenario": "opds",
                "steps": [{"name": "search", "ok": False, "detail": "no hit"}],
                "screenshot": "opds.png",
            }
        )
        self.assertEqual(
            summarize(self.results, "opds"),
            (
                False,
                f"FAIL opds: search: no hit (screenshot: {self.results / 'opds.png'})",
            ),
        )

    def test_fails_when_koreader_wrote_no_result(self):
        self.assertEqual(
            summarize(self.results, "opds"),
            (
                False,
                "FAIL opds: no result written; KOReader crashed or timed out "
                f"(see {self.results / 'opds.koreader.log'})",
            ),
        )

    def test_fails_when_result_is_not_valid_json(self):
        path = self.write_result("{not json")
        ok, message = summarize(self.results, "opds")
        self.assertFalse(ok)
        self.assertTrue(
            message.startswith(f"FAIL opds: unreadable result {path}: "),
            message,
        )

    def test_fails_when_result_has_no_steps(self):
        path = self.write_result({"scenario": "opds", "steps": []})
        self.assertEqual(
            summarize(self.results, "opds"),
            (False, f"FAIL opds: unreadable result {path}: no steps"),
        )

    def test_fails_omitting_the_screenshot_when_none_was_taken(self):
        self.write_result(
            {
                "scenario": "opds",
                "steps": [{"name": "open", "ok": False, "detail": "getPageCount() == 0"}],
            }
        )
        self.assertEqual(
            summarize(self.results, "opds"),
            (False, "FAIL opds: open: getPageCount() == 0"),
        )

    def test_fails_naming_the_step_when_the_screenshot_is_not_a_string(self):
        self.write_result(
            {
                "scenario": "opds",
                "steps": [{"name": "open", "ok": False, "detail": "getPageCount() == 0"}],
                "screenshot": 7,
            }
        )
        self.assertEqual(
            summarize(self.results, "opds"),
            (False, "FAIL opds: open: getPageCount() == 0"),
        )


class MainCliTests(unittest.TestCase):
    def setUp(self):
        self.results = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.results, True)

    def run_report(self, *scenarios: str) -> tuple[int, list[str]]:
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "koreader_report.py"), str(self.results), *scenarios],
            capture_output=True,
            text=True,
        )
        return result.returncode, result.stdout.splitlines()

    def test_prints_one_line_per_scenario_and_exits_one_when_one_fails(self):
        (self.results / "opds.json").write_text(
            json.dumps({"scenario": "opds", "steps": [{"name": "search", "ok": False, "detail": "no hit"}]})
        )
        (self.results / "other.json").write_text(
            json.dumps({"scenario": "other", "steps": [{"name": "search", "ok": True, "detail": "hit"}]})
        )
        self.assertEqual(
            self.run_report("opds", "other"),
            (1, ["FAIL opds: search: no hit", "PASS other"]),
        )

    def test_exits_zero_when_every_scenario_passes(self):
        (self.results / "opds.json").write_text(
            json.dumps({"scenario": "opds", "steps": [{"name": "search", "ok": True, "detail": "hit"}]})
        )
        self.assertEqual(self.run_report("opds"), (0, ["PASS opds"]))

    def test_exits_two_when_no_scenario_is_named(self):
        self.assertEqual(self.run_report(), (2, []))


if __name__ == "__main__":
    unittest.main()
