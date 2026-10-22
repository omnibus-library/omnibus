#!/usr/bin/env python3
"""Tests for scripts/koreader_report.py, the KOReader lane's per-scenario
PASS/FAIL report.

    python3 scripts/tests/koreader-report.test.py
"""

from __future__ import annotations

import json
import shutil
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

    def write_result(self, payload: object, name: str = "opds.json") -> Path:
        path = self.results / name
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

    def test_fails_naming_first_failed_step_and_screenshot(self):
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
                "screenshot": "opds.png",
            }
        )
        self.assertEqual(
            summarize(self.results, "opds"),
            (
                False,
                "FAIL opds: search: expected \"Alpha\" in search results, "
                'got ["Beta in the Series"] '
                f"(screenshot: {self.results / 'opds.png'})",
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


if __name__ == "__main__":
    unittest.main()
