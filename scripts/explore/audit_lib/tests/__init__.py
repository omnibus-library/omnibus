"""Unit tests for the intent-vs-state audit.

Run them with `python3 -m unittest discover -s scripts/explore -p 'tests.py'`
or via `just explore-test`, which `just test` depends on. Stdlib `unittest`
on purpose: the
exploration scripts assume nothing beyond the system Python `lib.sh` already
relies on, and no Nix shell here carries pytest.

The state-dependent tests drive a fake `ActorState` rather than the instance,
so the comparison rules — which are where a false positive comes from — are
covered without a live server.
"""

from __future__ import annotations

import unittest
from importlib import import_module

# One module per topic; `load_tests` gathers them so both entry points above
# still run the whole suite.
TOPICS = ("test_vocabulary", "test_fold", "test_compare", "test_replay", "test_inputs")


def load_tests(loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None) -> unittest.TestSuite:
    for topic in TOPICS:
        tests.addTests(loader.loadTestsFromModule(import_module(f"{__name__}.{topic}")))
    return tests
