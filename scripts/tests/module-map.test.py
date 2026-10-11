#!/usr/bin/env python3
"""Tests for scripts/module_map.py, the on-demand module map built from each
file's own module doc.

    python3 scripts/tests/module-map.test.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from module_map import summary  # noqa: E402


def write(root: Path, relative: str, text: str = "") -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


class RustSummaryTests(unittest.TestCase):
    def test_returns_first_sentence_of_a_wrapped_module_doc(self):
        source = (
            "//! Reading-stats aggregation over the session\n"
            "//! tables. Rationale lives in rule 10.\n"
            "\n"
            "use std::fmt;\n"
        )
        self.assertEqual(
            summary(source, "rust"),
            "Reading-stats aggregation over the session tables.",
        )

    def test_ignores_a_period_inside_backticks(self):
        source = "//! Wraps `ebook-convert. --help` output. Second.\n"
        self.assertEqual(
            summary(source, "rust"),
            "Wraps `ebook-convert. --help` output.",
        )

    def test_ignores_a_period_followed_by_lowercase(self):
        source = "//! Picks a cover, e.g. the largest one. Second.\n"
        self.assertEqual(
            summary(source, "rust"),
            "Picks a cover, e.g. the largest one.",
        )

    def test_returns_whole_paragraph_when_it_has_no_sentence_break(self):
        source = "//! Shared HTTP client\n//! for provider lookups\n\nuse x;\n"
        self.assertEqual(
            summary(source, "rust"),
            "Shared HTTP client for provider lookups",
        )

    def test_stops_at_the_end_of_the_first_paragraph(self):
        source = "//! Time-of-day rollups\n//!\n//! # Timezone\n//!\n//! Local.\n"
        self.assertEqual(summary(source, "rust"), "Time-of-day rollups")

    def test_returns_none_when_the_file_has_no_module_doc(self):
        source = "/// A function doc, not a module doc.\npub fn f() {}\n"
        self.assertIsNone(summary(source, "rust"))


class SwiftSummaryTests(unittest.TestCase):
    def test_returns_first_sentence_after_the_file_name_line(self):
        source = (
            "//  WidgetSnapshot.swift\n"
            "//  What the app hands the Home Screen: every book a card could\n"
            "//  draw. Second sentence.\n"
            "//\n"
            "//  A timeline render gets a tight budget.\n"
            "\n"
            "import Foundation\n"
        )
        self.assertEqual(
            summary(source, "swift"),
            "What the app hands the Home Screen: every book a card could draw.",
        )

    def test_returns_none_when_the_header_is_missing(self):
        source = "import SwiftUI\n// A stray comment.\nstruct V {}\n"
        self.assertIsNone(summary(source, "swift"))


class ModuleMapCliTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def run_map(self) -> list[str]:
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "module_map.py"), str(self.root)],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.splitlines()

    def test_prints_one_line_per_module_with_its_summary(self):
        write(self.root, "lib.rs", "//! Crate root.\n")
        write(self.root, "pool.rs", "//! SQLite pool init.\n")
        self.assertEqual(
            self.run_map(),
            ["lib.rs — Crate root.", "pool.rs — SQLite pool init."],
        )

    def test_lists_a_mod_rs_directory_under_its_own_summary(self):
        write(self.root, "stats/mod.rs", "//! Reading stats.\n")
        write(self.root, "stats/streak.rs", "//! Day streaks.\n")
        self.assertEqual(
            self.run_map(),
            ["stats/ — Reading stats.", "  streak.rs — Day streaks."],
        )

    def test_lists_a_file_and_directory_pair_once_as_the_directory(self):
        write(self.root, "sync.rs", "//! Indexer write path.\n")
        write(self.root, "sync/books.rs", "//! Book buckets.\n")
        self.assertEqual(
            self.run_map(),
            ["sync/ — Indexer write path.", "  books.rs — Book buckets."],
        )

    def test_skips_tests_files_and_directories(self):
        write(self.root, "auth.rs", "//! Auth data layer.\n")
        write(self.root, "auth/tests.rs", "//! Auth tests.\n")
        write(self.root, "books/mod.rs", "//! Book reads.\n")
        write(self.root, "books/tests/mod.rs", "//! Book tests.\n")
        self.assertEqual(
            self.run_map(),
            ["auth/ — Auth data layer.", "books/ — Book reads."],
        )

    def test_marks_a_module_with_no_doc(self):
        write(self.root, "palette.rs", "pub fn accent() {}\n")
        self.assertEqual(self.run_map(), ["palette.rs — (no module doc)"])

    def test_skips_non_source_files_and_directories_holding_none(self):
        write(self.root, "lib.rs", "//! Crate root.\n")
        write(self.root, "Info.plist", "<plist/>\n")
        write(self.root, "Assets.xcassets/Contents.json", "{}\n")
        self.assertEqual(self.run_map(), ["lib.rs — Crate root."])

    def test_reads_swift_files_by_their_header(self):
        write(self.root, "Reader/PDFZoomStore.swift", "//  PDFZoomStore.swift\n//  Per-book zoom.\n")
        self.assertEqual(
            self.run_map(),
            ["Reader/", "  PDFZoomStore.swift — Per-book zoom."],
        )


if __name__ == "__main__":
    unittest.main()
