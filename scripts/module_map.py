#!/usr/bin/env python3
"""Print a module map built from each source file's own module doc.

    scripts/module_map.py <dir>        e.g. db/src, frontend/src/pages, omnibus-ios

One line per module, indented by depth: the first sentence of a Rust file's
`//!` doc, or of a Swift file's header comment (the lines after
`//  Name.swift`). A directory module takes its `mod.rs` (or sibling
`<name>.rs`) doc. Tests, test helpers, Xcode test targets and non-source
files are skipped.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

LANGUAGES = {".rs": "rust", ".swift": "swift"}
DOC_PREFIX = {"rust": "//!", "swift": "//"}
SWIFT_NAME_LINE = re.compile(r"^//\s*\S+\.swift\s*$")
SENTENCE_END = re.compile(r"\.(?=$|\s+[^a-z])")
NO_DOC = "(no module doc)"
TEST_ONLY_STEMS = {"tests", "test_support"}


def doc_paragraph(source: str, language: str) -> str | None:
    """The module doc's first paragraph, joined onto one line."""
    source_lines = source.splitlines()
    if language == "swift":
        if not source_lines or not SWIFT_NAME_LINE.match(source_lines[0]):
            return None
        source_lines = source_lines[1:]
    prefix = DOC_PREFIX[language]
    lines = []
    for line in source_lines:
        text = line[len(prefix) :].strip()
        if not line.startswith(prefix) or not text:
            break
        lines.append(text)
    return " ".join(lines) or None


def summary(source: str, language: str) -> str | None:
    """The first sentence of a file's module doc, or None when it has none."""
    paragraph = doc_paragraph(source, language)
    if paragraph is None:
        return None
    for end in SENTENCE_END.finditer(paragraph):
        if paragraph.count("`", 0, end.start()) % 2 == 0:
            return paragraph[: end.end()]
    return paragraph


def file_summary(path: Path) -> str:
    return summary(path.read_text(), LANGUAGES[path.suffix]) or NO_DOC


def directory_module_file(directory: Path) -> Path | None:
    """A directory module's own file: its `mod.rs`, else the sibling `<name>.rs`."""
    for candidate in (directory / "mod.rs", directory.with_suffix(".rs")):
        if candidate.is_file():
            return candidate
    return None


def is_test_only(path: Path) -> bool:
    """A Rust test module or test helper, or an Xcode test target directory."""
    is_xcode_test_target = path.is_dir() and path.name.endswith("Tests")
    return path.stem in TEST_ONLY_STEMS or is_xcode_test_target


def is_listed_file(path: Path) -> bool:
    """A source file that is not already listed as its directory's module."""
    return (
        path.suffix in LANGUAGES
        and path.name != "mod.rs"
        and not path.with_suffix("").is_dir()
    )


def module_lines(directory: Path, depth: int = 0) -> list[str]:
    """One indented `name — summary` line per module under `directory`."""
    lines = []
    indent = "  " * depth
    for path in sorted(directory.iterdir()):
        if is_test_only(path):
            continue
        if path.is_dir():
            children = module_lines(path, depth + 1)
            module_file = directory_module_file(path)
            if module_file:
                lines.append(f"{indent}{path.name}/ — {file_summary(module_file)}")
            elif children:
                lines.append(f"{indent}{path.name}/")
            lines.extend(children)
        elif is_listed_file(path):
            lines.append(f"{indent}{path.name} — {file_summary(path)}")
    return lines


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not Path(argv[1]).is_dir():
        print(__doc__, file=sys.stderr)
        return 2
    print("\n".join(module_lines(Path(argv[1]))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
