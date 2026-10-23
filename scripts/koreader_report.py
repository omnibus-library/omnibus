#!/usr/bin/env python3
"""Report KOReader E2E lane results: one PASS/FAIL line per scenario.

    python3 scripts/koreader_report.py <results_dir> <scenario>...

Reads each <results_dir>/<scenario>.json (written by the lane's KOReader
user patch) and prints the lane's verdict line. Exits 1 if any scenario
failed, else 0.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def summarize(results_dir: str | Path, scenario: str) -> tuple[bool, str]:
    """Verdict and message for one scenario's result file.

    A scenario passes iff its result holds at least one step and every step
    is ok. Anything else is a named failure; a bad file never raises.
    """
    results = Path(results_dir)
    path = results / f"{scenario}.json"
    if not path.is_file():
        return False, (
            f"FAIL {scenario}: no result written; KOReader crashed or timed out "
            f"(see {results / f'{scenario}.koreader.log'})"
        )
    try:
        data = json.loads(path.read_text())
        steps = data.get("steps")
        if not steps:
            raise ValueError("no steps")
        failed = next((step for step in steps if not step.get("ok")), None)
    except (OSError, ValueError, TypeError, AttributeError) as e:
        return False, f"FAIL {scenario}: unreadable result {path}: {e}"
    if failed is None:
        return True, f"PASS {scenario}"
    screenshot = data.get("screenshot")
    shot = f" (screenshot: {results / screenshot})" if isinstance(screenshot, str) else ""
    return False, f"FAIL {scenario}: {failed.get('name', '?')}: {failed.get('detail', '')}{shot}"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: koreader_report.py <results_dir> <scenario>...", file=sys.stderr)
        return 2
    results_dir, scenarios = argv[0], argv[1:]
    failed = False
    for scenario in scenarios:
        ok, message = summarize(results_dir, scenario)
        print(message)
        if not ok:
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
