#!/usr/bin/env python3
"""Tests for the exploration run report and its journal/log correlation.

Run them directly — the workspace's `just test` covers the Rust crates and there
is no Python lane:

    python3 scripts/explore/tests/test_report.py
    python3 -m unittest discover -s scripts/explore/tests

Two fixtures under `fixtures/` carry the cases worth pinning, and both are
miniatures of something that really happened on the instance:

- `r-fixture-clean` — two agents, two flows, every verdict `pass`, an audit with
  nothing to report and a log window holding only 2xx/304. It exists so the
  "clean run says so in one paragraph" contract has something to assert against.
- `r-fixture-crossagent` — run r-20260828-02's 16:11:57 warning, reduced to its
  bones: a warning about book A, one agent's *unrelated* write ten seconds later
  and the owning agent's write twenty seconds after that. Nearest-in-time gets
  this wrong; identity-first gets it right.
"""

from __future__ import annotations

import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import correlate  # noqa: E402
import report  # noqa: E402

FIXTURES = HERE / "fixtures"
CLEAN = "r-fixture-clean"
CROSS = "r-fixture-crossagent"
AUDIO = "3dcedaed-3791-476c-9ede-351f2bbd2b53"
MERGED = "ef17e9a5-73bc-4bc1-9825-8c4b4cce426a"


def ts(text: str) -> datetime:
    return correlate.parse_ts(text)


def run_cli(argv: list[str]) -> str:
    """Run `report.main` with `argv`, returning whatever it printed."""
    buf = io.StringIO()
    old = sys.argv
    sys.argv = argv
    try:
        with redirect_stdout(buf):
            report.main()
    finally:
        sys.argv = old
    return buf.getvalue()


def render(run_id: str, *extra: str) -> str:
    """Run the CLI end to end, exactly as an operator would, and capture it."""
    return run_cli(["report.py", run_id, "--journal-dir", str(FIXTURES), "--out", "-", *extra])


def doc(text: str, name: str) -> str:
    """One file out of `--out -` output, which prints each under `==> name <==`."""
    parts = re.split(r"^==> (\S+) <==\n", text, flags=re.M)
    return dict(zip(parts[1::2], parts[2::2]))[name]


def render_files(journal_dir: str, run_id: str, *extra: str) -> dict[str, str]:
    """Run the CLI with its default output, then read back every file it wrote."""
    run_cli(["report.py", run_id, "--journal-dir", journal_dir, *extra])
    return {p.name: p.read_text() for p in (Path(journal_dir) / run_id).glob("*.md")}


def verdict_of(text: str) -> str:
    """The verdict paragraph — the first prose paragraph in the document."""
    return next(p.strip() for p in text.split("\n\n") if p.strip().startswith("**"))


def journal(run_id: str) -> correlate.Run:
    return correlate.load_journal(FIXTURES / run_id / "journal.jsonl", run_id)


def log_findings(run_id: str, pad_s: int = 120) -> list[correlate.LogFinding]:
    run = journal(run_id)
    pad = timedelta(seconds=pad_s)
    return correlate.read_server_log(
        [FIXTURES / run_id / "server.log"], (run.started - pad, run.ended + pad)
    )


def write_journal(dir_: Path, run_id: str, rows: list[dict]) -> Path:
    dir_.mkdir(parents=True, exist_ok=True)
    path = dir_ / "journal.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return path


def write_groups(dir_: Path, defects: list[dict] | None = None,
                 execution: list[dict] | None = None) -> None:
    """The runner's `groups.json`: each side present only when given."""
    data = {k: v for k, v in (("defects", defects), ("execution", execution)) if v is not None}
    (dir_ / "groups.json").write_text(json.dumps(data))


def row(ts_text: str, actor: str, action: str, run: str = "r-tmp", **kw) -> dict:
    base = {
        "ts": ts_text, "run": run, "actor": actor, "surface": "web",
        "flow": kw.pop("flow", "reading_a_book"), "seq": kw.pop("seq", 1),
        "action": action, "target": kw.pop("target", None),
        "params": kw.pop("params", {}), "outcome": kw.pop("outcome", "ok"),
        "note": kw.pop("note", None),
    }
    base.update(kw)
    return base


class LoadJournalTests(unittest.TestCase):
    def test_load_journal_numbers_every_line_so_a_finding_can_cite_one(self):
        run = journal(CLEAN)
        self.assertEqual([e.line for e in run.entries], list(range(1, 9)))
        self.assertEqual(run.run_id, CLEAN)
        self.assertEqual(run.actors, ["agent-1", "agent-2"])

    def test_load_journal_reads_the_instance_url_off_a_flow_start(self):
        self.assertEqual(journal(CLEAN).base_url, "https://omnibus-test.example")

    def test_load_journal_skips_lines_belonging_to_another_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_journal(Path(tmp), "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.start"),
                row("2026-08-28T10:00:01Z", "agent-9", "flow.start", run="r-other"),
            ])
            run = correlate.load_journal(path, "r-tmp")
        self.assertEqual(len(run.entries), 1)
        self.assertEqual(run.foreign_runs, {"r-other"})

    def test_load_journal_records_unparseable_lines_rather_than_dropping_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "journal.jsonl"
            path.write_text(
                json.dumps(row("2026-08-28T10:00:00Z", "agent-1", "flow.start")) + "\n"
                + "{not json\n"
                + json.dumps({"actor": "agent-1"}) + "\n"
            )
            run = correlate.load_journal(path, "r-tmp")
        self.assertEqual(run.malformed, [2, 3])

    def test_load_journal_raises_when_nothing_in_the_file_is_usable(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "journal.jsonl"
            path.write_text("{nope\n")
            with self.assertRaises(ValueError):
                correlate.load_journal(path, "r-tmp")

    def test_line_of_resolves_the_actor_and_seq_an_audit_finding_cites(self):
        run = journal(CLEAN)
        self.assertEqual(run.line_of("agent-2", 2), 5)
        self.assertIsNone(run.line_of("agent-2", 99))


class FlowSpanTests(unittest.TestCase):
    def test_spans_pairs_a_start_with_its_end_per_actor(self):
        spans = journal(CLEAN).spans()
        self.assertEqual(len(spans), 2)
        self.assertTrue(all(s.verdict == "pass" for s in spans))
        self.assertTrue(all(s.start and s.end for s in spans))

    def test_spans_keeps_a_flow_that_never_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_journal(Path(tmp), "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.start"),
            ])
            spans = correlate.load_journal(path, "r-tmp").spans()
        self.assertEqual([s.verdict for s in spans], ["unclosed"])
        self.assertIsNone(spans[0].end)

    def test_spans_keeps_a_flow_end_that_was_never_opened(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_journal(Path(tmp), "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.end",
                    params={"verdict": "fail", "reason": "aborted"}),
            ])
            spans = correlate.load_journal(path, "r-tmp").spans()
        self.assertEqual([s.verdict for s in spans], ["fail"])
        self.assertIsNone(spans[0].start)

    def test_covers_is_false_for_a_span_with_no_start(self):
        span = correlate.FlowSpan("agent-1", "f", None, None)
        self.assertFalse(span.covers(ts("2026-08-28T10:00:00Z")))


class ParseServerLogTests(unittest.TestCase):
    def test_parse_server_log_keeps_warnings_and_non_2xx_but_not_2xx_or_304(self):
        found = log_findings(CLEAN)
        self.assertEqual(found, [], "a 200, a 304 and a 201 are not findings")

    def test_parse_server_log_drops_lines_outside_the_run_window(self):
        # A boot WARN 20 minutes early and a 500 an hour late both sit in the file.
        raw = (FIXTURES / CLEAN / "server.log").read_text().splitlines()
        wide = correlate.parse_server_log(
            raw, (ts("2026-01-01T00:00:00Z"), ts("2027-01-01T00:00:00Z"))
        )
        self.assertEqual({f.level for f in wide}, {"WARN", "ERROR"})
        self.assertEqual(len(wide), 2)

    def test_parse_server_log_extracts_uuids_from_the_path_and_the_fields(self):
        by_msg = {f.message: f for f in log_findings(CROSS)}
        backward = by_msg["accepted audio write moved position backward past threshold"]
        self.assertEqual(backward.uuids, (AUDIO,))
        cover = by_msg["cover: no cover image on record (404)"]
        self.assertEqual(cover.uuids, (MERGED,))

    def test_parse_server_log_ignores_requests_the_browser_makes_on_its_own(self):
        line = json.dumps({
            "timestamp": "2026-08-28T18:01:00Z", "level": "INFO",
            "target": "tower_http::trace::on_response",
            "fields": {"message": "finished processing request", "status": 404},
            "span": {"method": "GET", "path": "/favicon.ico", "name": "request"},
        })
        window = (ts("2026-08-28T17:00:00Z"), ts("2026-08-28T19:00:00Z"))
        self.assertEqual(correlate.parse_server_log([line], window), [])

    def test_parse_server_log_marks_a_line_with_no_span_as_process_level(self):
        found = log_findings(CROSS)
        convert = next(f for f in found if f.target == "omnibus::convert")
        self.assertFalse(convert.request_scoped)

    def test_fold_response_lines_merges_a_handler_warning_with_its_response_line(self):
        found = log_findings(CROSS)
        self.assertEqual(len(found), 5)
        folded = correlate.fold_response_lines(found)
        self.assertEqual(len(folded), 4, "the cover WARN and its 404 are one request")
        cover = next(f for f in folded if f.target == "omnibus::backend::covers")
        self.assertEqual(cover.status, 404)
        self.assertEqual(cover.headline, f"404 GET /api/covers/{MERGED}")
        self.assertEqual(cover.subtitle, "cover: no cover image on record (404)")

    def test_subtitle_is_empty_when_the_headline_already_carries_the_message(self):
        found = log_findings(CROSS)
        failure = next(f for f in found if f.level == "ERROR")
        self.assertEqual(failure.subtitle, "")

    def test_headline_fields_are_not_repeated_under_detail(self):
        found = log_findings(CROSS)
        failure = next(f for f in found if f.level == "ERROR")
        self.assertEqual(failure.detail, "", "status and classification are in the headline")


class AttributionTests(unittest.TestCase):
    def setUp(self):
        self.run = journal(CROSS)
        self.spans = self.run.spans()
        self.findings = correlate.fold_response_lines(log_findings(CROSS))

    def find(self, needle: str) -> correlate.LogFinding:
        return next(f for f in self.findings if needle in f.headline or needle in f.message)

    def test_attribute_prefers_a_uuid_match_over_a_nearer_entry_from_another_agent(self):
        finding = self.find("moved position backward")
        attr = correlate.attribute(finding, self.run, self.spans)
        self.assertEqual(attr.basis, "target uuid")
        self.assertEqual(attr.entry.actor, "agent-2")
        self.assertEqual(attr.entry.action, "player.seek")
        # agent-1's merge.confirm is ten seconds closer and about a different book.
        nearest = min(self.run.entries, key=lambda e: abs((e.ts - finding.ts).total_seconds()))
        self.assertEqual(nearest.actor, "agent-1")

    def test_attribute_matches_an_entry_stamped_after_the_log_line_it_caused(self):
        attr = correlate.attribute(self.find("moved position backward"), self.run, self.spans)
        self.assertGreater(attr.delta, 0, "agents journal after the act, not before")
        self.assertEqual(correlate.fmt_delta(attr.delta), "+30.0s")

    def test_attribute_falls_back_to_time_when_the_line_names_no_book(self):
        finding = self.find("merge-books/undo")
        self.assertEqual(finding.headline, "500 POST /api/rpc/merge-books/undo",
                         "a 500 must not render as bare 'response failed'")
        attr = correlate.attribute(finding, self.run, self.spans)
        self.assertEqual(attr.basis, "time")
        self.assertEqual(attr.entry.actor, "agent-2")

    def test_attribute_reports_no_entry_when_nothing_is_inside_the_window(self):
        finding = self.find("moved position backward")
        attr = correlate.attribute(finding, self.run, self.spans, window_s=1.0)
        self.assertIsNone(attr.entry)
        self.assertEqual(attr.basis, "none")
        self.assertIn("no journal entry in window", attr.cite)

    def test_attribute_names_the_flows_in_flight_at_that_instant(self):
        attr = correlate.attribute(self.find("moved position backward"), self.run, self.spans)
        self.assertEqual(
            attr.in_flight,
            [("agent-1", "merging_books"), ("agent-2", "listening_to_audiobook")],
        )

    def test_attribute_lists_the_other_actors_work_nearby_with_signed_offsets(self):
        attr = correlate.attribute(self.find("moved position backward"), self.run, self.spans)
        actors = {e.actor for e, _ in attr.neighbours}
        self.assertEqual(actors, {"agent-1"}, "only the actors it was not attributed to")
        entry, delta = attr.neighbours[0]
        self.assertEqual(entry.action, "merge.confirm")
        self.assertEqual(correlate.fmt_delta(delta), "+10.0s")

    def test_group_and_attribute_ranks_an_error_above_a_warning(self):
        groups = correlate.group_and_attribute(log_findings(CROSS), self.run)
        self.assertEqual(groups[0].first.level, "ERROR")
        self.assertEqual(groups[-1].first.target, "omnibus::convert",
                         "a process-level line sorts last, having nothing to attribute")

    def test_group_and_attribute_collapses_identical_repeats(self):
        run = self.run
        repeats = [
            correlate.LogFinding(
                ts=ts(f"2026-08-28T18:01:0{i}Z"), level="INFO", target="t",
                message="", status=404, method="GET", path="/OEBPS/f.ttf",
                uuids=(), detail="", request_scoped=True,
            )
            for i in range(3)
        ]
        groups = correlate.group_and_attribute(repeats, run)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].count, 3)
        self.assertEqual(sum(groups[0].actors.values()), 3)


class SeverityTests(unittest.TestCase):
    def test_ranked_anomalies_orders_high_before_low(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_journal(Path(tmp), "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "low", "expected": "e", "observed": "o"}),
                row("2026-08-28T10:00:01Z", "agent-1", "anomaly", seq=2,
                    params={"severity": "high", "expected": "e", "observed": "o"}),
                row("2026-08-28T10:00:02Z", "agent-1", "anomaly", seq=3,
                    params={"severity": "medium", "expected": "e", "observed": "o"}),
            ])
            ranked = correlate.ranked_anomalies(correlate.load_journal(path, "r-tmp"))
        self.assertEqual([a.severity for a in ranked], ["high", "medium", "low"])

    def test_ranked_anomalies_keeps_an_invented_severity_and_sorts_it_last(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_journal(Path(tmp), "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "showstopper"}),
                row("2026-08-28T10:00:01Z", "agent-1", "anomaly", seq=2,
                    params={"severity": "low"}),
                row("2026-08-28T10:00:02Z", "agent-1", "anomaly", seq=3, params={}),
            ])
            ranked = correlate.ranked_anomalies(correlate.load_journal(path, "r-tmp"))
        self.assertEqual([a.severity for a in ranked],
                         ["low", "showstopper", correlate.UNRANKED])

    def test_family_groups_the_leaf_names_agents_invent_for_one_act(self):
        entries = [
            correlate.Entry(1, ts("2026-08-28T10:00:00Z"), "a", "f", 1, name,
                            None, {}, "ok", None)
            for name in ("book.open", "book.detail.open", "book.view")
        ]
        self.assertEqual({e.family for e in entries}, {"book"})


class FetchServerLogTests(unittest.TestCase):
    def test_fetch_server_log_reports_unavailable_when_ssh_cannot_connect(self):
        window = (ts("2026-08-28T18:00:00Z"), ts("2026-08-28T18:05:00Z"))
        real = subprocess.run

        def boom(*a, **kw):
            raise OSError("ssh: no route to host")

        subprocess.run = boom
        try:
            findings, status = correlate.fetch_server_log(window, "nowhere", "d", "l")
        finally:
            subprocess.run = real
        self.assertEqual(findings, [])
        self.assertTrue(status.startswith("unavailable"))

    def test_fetch_server_log_reports_unavailable_on_a_nonzero_exit(self):
        window = (ts("2026-08-28T18:00:00Z"), ts("2026-08-28T18:05:00Z"))
        real = subprocess.run

        class Proc:
            returncode = 255
            stdout = ""
            stderr = "ssh: Could not resolve hostname nowhere\n"

        subprocess.run = lambda *a, **kw: Proc()
        try:
            _, status = correlate.fetch_server_log(window, "nowhere", "d", "l")
        finally:
            subprocess.run = real
        self.assertTrue(status.startswith("unavailable"))
        self.assertIn("Could not resolve hostname", status)


class ReportTests(unittest.TestCase):
    """The acceptance criteria, asserted against rendered markdown."""

    def test_report_names_the_run_id_duration_roster_and_instance_url(self):  # AC1
        text = render(CLEAN, "--server-log", str(FIXTURES / CLEAN / "server.log"))
        self.assertIn(f"# Exploration run {CLEAN}", text)
        self.assertIn("| Duration | 3m 19s |", text)
        self.assertIn("| Agents | agent-1, agent-2 |", text)
        self.assertIn("| Instance | https://omnibus-test.example |", text)

    def test_report_cites_a_journal_line_for_every_anomaly(self):  # AC2
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.start", seq=1),
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=2,
                    params={"severity": "high", "expected": "a", "observed": "b",
                            "repro": "open the book twice"},
                    note="the thing went wrong"),
                row("2026-08-28T10:00:15Z", "agent-1", "anomaly", seq=3,
                    params={"severity": "low", "expected": "c", "observed": "d"},
                    note="cosmetic"),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=4,
                    params={"verdict": "fail", "reason": "r"}),
            ])
            text = doc(render("r-tmp", "--journal-dir", tmp, "--no-server-log"), "defects.md")
        # Every row carries its line, whether or not it earns a detail block.
        self.assertIn("| 1 | high | the thing went wrong (`L2`) | agent-1 |", text)
        self.assertIn("| 2 | low | cosmetic (`L3`) | agent-1 |", text)
        self.assertIn("**Repro** open the book twice", text)
        self.assertIn("**Replay** `sed -n '2p'", text)

    def test_report_splits_defects_from_execution_issues_on_the_agents_own_kind(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.start", seq=1),
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=2,
                    params={"severity": "high", "expected": "a", "observed": "b"},
                    note="the cover never loaded"),
                row("2026-08-28T10:00:15Z", "agent-2", "anomaly", seq=1,
                    params={"severity": "medium", "kind": "issue"},
                    note="the shelf picker took 20s to respond"),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=3,
                    params={"verdict": "fail", "reason": "r"}),
            ])
            text = render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        defects, issues = doc(text, "defects.md"), doc(text, "execution-defects.md")
        self.assertIn("| 1 | high | the cover never loaded (`L2`) | agent-1 |", defects)
        self.assertNotIn("the shelf picker", defects)
        self.assertIn("| 1 | medium | the shelf picker took 20s to respond (`L3`) | agent-2 |",
                      issues)
        self.assertIn("#### Defect 1.", defects)
        self.assertIn("#### Issue 1.", issues)

    def test_an_anomaly_with_no_kind_or_an_unknown_one_is_reported_as_a_defect(self):
        """Misfiling friction costs a row; misfiling a defect loses it.

        Both branches, because they are different contracts: an agent that
        never learned about `kind` writes no key at all, and one that invented
        a word writes an unrecognised one.
        """
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high"}, note="no kind at all"),
                row("2026-08-28T10:00:11Z", "agent-1", "anomaly", seq=2,
                    params={"severity": "low", "kind": "whatever"},
                    note="a kind nobody defined"),
            ])
            text = render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertIn("| 1 | high | no kind at all (`L1`) | agent-1 |", doc(text, "defects.md"))
        self.assertIn("| 2 | low | a kind nobody defined (`L2`) | agent-1 |",
                      doc(text, "defects.md"))
        self.assertNotIn("(`L", doc(text, "execution-defects.md"))

    def test_report_ends_with_the_journal_file_locations(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.start", seq=1),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=2,
                    params={"verdict": "pass", "reason": "r"}),
            ])
            text = render("r-tmp", "--journal-dir", tmp, "--no-server-log")
            self.assertIn("## Journal files", text)
            self.assertIn(f"- Run directory — `{Path(tmp) / 'r-tmp'}`", text)
            self.assertIn(f"- Journal — `{Path(tmp) / 'r-tmp' / 'journal.jsonl'}` "
                          "(2 entries)", text)
            # An absent audit is named, not omitted — same rule as the verdict.
            self.assertIn("- Audit — not written", text)

    def test_clean_run_says_so_in_its_first_paragraph(self):  # AC3
        text = doc(render(CLEAN, "--server-log", str(FIXTURES / CLEAN / "server.log")),
                   "report.md")
        paragraph = verdict_of(text)
        # It is the first paragraph, not merely present somewhere.
        self.assertEqual(text.split("\n\n")[2].strip(), paragraph)
        self.assertTrue(paragraph.startswith("**Clean run.**"), paragraph)
        self.assertIn("6 writes it checked", paragraph)
        self.assertIn("no non-2xx response", paragraph)

    def test_clean_run_omits_every_section_that_would_say_nothing(self):  # AC3
        text = doc(render(CLEAN, "--server-log", str(FIXTURES / CLEAN / "server.log")),
                   "report.md")
        headings = [l for l in text.splitlines() if l.startswith("## ")]
        # "Journal files" is the one section that always renders: it is never
        # empty, and every citation above it is useless without the path.
        self.assertEqual(headings, ["## Coverage", "## Journal files"])

    def test_clean_run_verdict_states_the_caveat_when_an_input_was_not_read(self):
        text = render(CLEAN, "--no-server-log")
        paragraph = verdict_of(text)
        self.assertTrue(paragraph.startswith("**No findings.**"), paragraph)
        self.assertIn("The server log was **not read** (`--no-server-log`)", paragraph)

    def test_report_attributes_a_server_log_finding_to_the_action_that_caused_it(self):  # AC4
        text = doc(render(CROSS, "--server-log", str(FIXTURES / CROSS / "server.log")),
                   "timeline.md")
        self.assertIn("## Server log", text)
        self.assertIn("**Attributed to** L4 · agent-2 seq 2 · player.seek "
                      "(+30.0s, by target uuid)", text)
        self.assertIn("**In flight** agent-1 merging_books · "
                      "agent-2 listening_to_audiobook", text)
        self.assertIn("**Other actors nearby** agent-1 `L3` `merge.confirm` +10.0s", text)

    def test_report_says_a_process_level_line_cannot_be_attributed(self):
        text = doc(render(CROSS, "--server-log", str(FIXTURES / CROSS / "server.log")),
                   "timeline.md")
        self.assertIn("no request span", text)

    def test_report_marks_a_run_that_aborted_rather_than_one_that_was_quiet(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "anomaly", seq=1,
                    flow="run.preflight", outcome="error",
                    params={"severity": "high", "expected": "a", "observed": "b"}),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=2,
                    flow="run.preflight", outcome="error",
                    params={"verdict": "fail", "reason": "shared browser profile"}),
            ])
            text = render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertIn("**Run aborted.**", text)
        self.assertIn("## Run integrity", text)
        self.assertIn("`fail` · never opened", text)
        self.assertIn("shared browser profile", text)

    def test_report_flags_journal_lines_it_could_not_parse(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            d.mkdir()
            (d / "journal.jsonl").write_text(
                json.dumps(row("2026-08-28T10:00:00Z", "agent-1", "flow.start")) + "\n"
                + "{broken\n"
            )
            text = render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertIn("1 journal line could not be parsed: L2", text)

    def test_audit_findings_are_cited_by_journal_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.start", seq=1),
                row("2026-08-28T10:00:10Z", "agent-1", "highlight.create", seq=2,
                    target=AUDIO),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=3,
                    params={"verdict": "pass"}),
            ])
            (d / "audit.json").write_text(json.dumps({
                "run": "r-tmp", "checked": 4,
                "baseline_snapshot": "20260828T100000Z-pre",
                "findings": [{
                    "actor": "agent-1", "seq": 2, "kind": "missing",
                    "what": "highlight", "target": AUDIO,
                    "expected": "highlight with note 'check the appendix'",
                    "observed": "no highlight at that location", "replay_from": 2,
                }],
                "unverifiable": [
                    {"actor": "agent-1", "seq": 2, "why": "metadata override — out of scope"},
                ],
            }))
            text = render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertIn("## Audit reconciliation", text)
        self.assertIn("4 journalled writes checked against baseline "
                      "`20260828T100000Z-pre`", text)
        self.assertIn("| missing | agent-1 | highlight |", text)
        self.assertIn("`L2` (seq 2) |", text)
        self.assertIn("agent-1 `L2` — metadata override", doc(text, "timeline.md"))

    def test_audit_naming_a_different_run_is_flagged_not_silently_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.start", seq=1),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=2,
                    params={"verdict": "pass"}),
            ])
            (d / "audit.json").write_text(json.dumps({
                "run": "r-somewhere-else", "checked": 1,
                "findings": [{"actor": "agent-1", "seq": 1, "kind": "unexpected",
                              "what": "rating", "target": AUDIO,
                              "expected": "none", "observed": "4 of 5"}],
                "unverifiable": [],
            }))
            text = render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertIn("names run `r-somewhere-else`, not `r-tmp`", text)

    def test_unreadable_audit_is_a_caveat_not_a_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.start", seq=1),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=2,
                    params={"verdict": "pass"}),
            ])
            (d / "audit.json").write_text("{ not json")
            text = render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertIn("the audit output **could not be read**", text)
        self.assertNotIn("**Clean run.**", text)

    def test_timeline_carries_every_entry_and_is_collapsed_by_default(self):
        text = doc(render(CLEAN, "--server-log", str(FIXTURES / CLEAN / "server.log")),
                   "timeline.md")
        self.assertIn("<details><summary>Merged, all agents in clock order "
                      "(8 entries)</summary>", text)
        for line in range(1, 9):
            self.assertIn(f"| `L{line}` |", text)

    def test_no_timeline_drops_the_section_entirely(self):
        text = doc(render(CLEAN, "--no-server-log", "--no-timeline"), "timeline.md")
        self.assertNotIn("## Timeline", text)

    def test_detail_severity_controls_which_anomalies_are_expanded(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "low", "expected": "a", "observed": "b"}),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=2,
                    params={"verdict": "pass"}),
            ])
            default = doc(render("r-tmp", "--journal-dir", tmp, "--no-server-log"),
                          "defects.md")
            widened = doc(render("r-tmp", "--journal-dir", tmp, "--no-server-log",
                                 "--detail-severity", "low"), "defects.md")
        self.assertNotIn("### Detail", default)
        self.assertIn("### Detail — low and above", widened)

    def test_a_run_that_recorded_no_flow_is_not_called_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "note", seq=1,
                    params={"detail": "looked around"}),
            ])
            text = render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertNotIn("**Clean run.**", text)
        self.assertIn("**No findings.**", text)

    def test_detail_takes_the_first_spelling_an_agent_used_for_a_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high", "expected": "a", "observed": "b",
                            "reproduce": "click it twice", "surface": "the player",
                            "why_it_matters": "the reader loses their place"}),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=2,
                    params={"verdict": "pass"}),
            ])
            text = doc(render("r-tmp", "--journal-dir", tmp, "--no-server-log"), "defects.md")
        self.assertIn("**Repro** click it twice", text)
        self.assertIn("**Where** the player", text)
        self.assertIn("**Impact** the reader loses their place", text)

    def test_an_invalid_detail_severity_exits_rather_than_expanding_everything(self):
        with self.assertRaises(SystemExit):
            render(CLEAN, "--no-server-log", "--detail-severity", "spicy")

    def test_missing_journal_exits_with_a_pointer_to_the_path(self):
        with self.assertRaises(SystemExit):
            render("r-does-not-exist")


class ReportFilesTests(unittest.TestCase):
    """The run's output split into a summary and its detail files (#2709)."""

    def test_report_writes_the_summary_defects_execution_and_timeline_files(self):  # AC1
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.start", seq=1),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=2,
                    params={"verdict": "pass"}),
            ])
            files = render_files(tmp, "r-tmp", "--no-server-log")
        self.assertEqual(sorted(files),
                         ["defects.md", "execution-defects.md", "report.md", "timeline.md"])

    def test_report_leaves_the_timeline_out_of_the_summary(self):  # AC2
        text = render(CLEAN, "--server-log", str(FIXTURES / CLEAN / "server.log"))
        self.assertNotIn("## Timeline", doc(text, "report.md"))
        self.assertIn("## Timeline", doc(text, "timeline.md"))

    def test_report_leaves_every_row_table_out_of_the_summary(self):  # AC2
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high"}, note="the cover never loaded"),
                row("2026-08-28T10:00:15Z", "agent-2", "anomaly", seq=1,
                    params={"severity": "low", "kind": "issue"}, note="the picker was slow"),
            ])
            text = doc(render("r-tmp", "--journal-dir", tmp, "--no-server-log"), "report.md")
        self.assertNotIn("| # | Priority | Description | Agent |", text)
        self.assertNotIn("the cover never loaded", text)
        self.assertNotIn("the picker was slow", text)

    def test_report_summary_says_the_rows_were_not_grouped_without_a_groups_file(self):  # AC5
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high"}, note="the cover never loaded"),
                row("2026-08-28T10:00:15Z", "agent-2", "anomaly", seq=1,
                    params={"severity": "low", "kind": "issue"}, note="the picker was slow"),
            ])
            text = doc(render("r-tmp", "--journal-dir", tmp, "--no-server-log"), "report.md")
        self.assertIn("## Defects\n\n1 defect (1 high), **not grouped** — no `groups.json` "
                      "beside the journal. Every row is in `defects.md`.", text)
        self.assertIn("## Execution issues\n\n1 execution issue (1 low), **not grouped** — no "
                      "`groups.json` beside the journal. Every row is in "
                      "`execution-defects.md`.", text)

    def test_report_lists_the_groups_before_every_defect_row(self):  # AC3
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high"}, note="the cover never loaded"),
                row("2026-08-28T10:00:11Z", "agent-1", "anomaly", seq=2,
                    params={"severity": "low"}, note="the cover was blurry"),
                row("2026-08-28T10:00:12Z", "agent-1", "anomaly", seq=3,
                    params={"severity": "medium"}, note="the shelf name was wrong"),
            ])
            write_groups(d, defects=[
                {"title": "Shelves", "root_cause": "stale name", "checked": False, "lines": [3]},
                {"title": "Covers", "root_cause": "thumb cache", "checked": True, "lines": [1, 2]},
            ])
            text = doc(render("r-tmp", "--journal-dir", tmp, "--no-server-log"), "defects.md")
        self.assertIn(
            "## Groups\n\n| G | Group | Priority | Rows | Root cause | Checked |\n"
            "|---:|---|---|---|---|---|\n"
            "| 1 | Covers | high | 1, 3 | thumb cache | ✅ |\n"
            "| 2 | Shelves | medium | 2 | stale name | — |\n\n"
            "## All defects\n\n| # | Priority | Description | Agent | Group |\n"
            "|---:|---|---|---|---|\n"
            "| 1 | high | the cover never loaded (`L1`) | agent-1 | G1 |\n"
            "| 2 | medium | the shelf name was wrong (`L3`) | agent-1 | G2 |\n"
            "| 3 | low | the cover was blurry (`L2`) | agent-1 | G1 |", text)

    def test_report_summary_lists_each_defect_group_with_its_priority_and_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high"}, note="the cover never loaded"),
                row("2026-08-28T10:00:11Z", "agent-1", "anomaly", seq=2,
                    params={"severity": "low"}, note="the cover was blurry"),
                row("2026-08-28T10:00:12Z", "agent-1", "anomaly", seq=3,
                    params={"severity": "medium"}, note="the shelf name was wrong"),
            ])
            write_groups(d, defects=[
                {"title": "Shelves", "root_cause": "stale name", "lines": [3]},
                {"title": "Covers", "root_cause": "thumb cache", "lines": [1, 2]},
            ])
            text = doc(render("r-tmp", "--journal-dir", tmp, "--no-server-log"), "report.md")
        self.assertIn(
            "## Defects\n\n3 defects (1 high, 1 medium, 1 low) in 2 groups. "
            "Every row is in `defects.md`.\n\n"
            "| G | Group | Priority | Rows |\n|---:|---|---|---:|\n"
            "| 1 | Covers | high | 2 |\n| 2 | Shelves | medium | 1 |", text)

    def test_report_groups_execution_issues_the_same_way_as_defects(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:15Z", "agent-2", "anomaly", seq=1,
                    params={"severity": "low", "kind": "issue"}, note="the picker was slow"),
            ])
            write_groups(d, execution=[
                {"title": "Slow controls", "root_cause": "shared instance load", "lines": [1]},
            ])
            text = doc(render("r-tmp", "--journal-dir", tmp, "--no-server-log"),
                       "execution-defects.md")
        self.assertIn("| 1 | Slow controls | low | 1 | shared instance load | — |", text)
        self.assertIn("| 1 | low | the picker was slow (`L1`) | agent-2 | G1 |", text)

    def test_report_exits_naming_a_defect_left_out_of_every_group(self):  # AC4
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high"}, note="the cover never loaded"),
                row("2026-08-28T10:00:11Z", "agent-1", "anomaly", seq=2,
                    params={"severity": "low"}, note="the cover was blurry"),
            ])
            write_groups(d, defects=[{"title": "Covers", "lines": [1]}])
            with self.assertRaises(SystemExit) as raised:
                render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertEqual(str(raised.exception.code),
                         "groups.json: defect L2 is in no group")

    def test_report_exits_naming_a_defect_placed_in_two_groups(self):  # AC4
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high"}, note="the cover never loaded"),
            ])
            write_groups(d, defects=[{"title": "Covers", "lines": [1]},
                                     {"title": "Thumbnails", "lines": [1]}])
            with self.assertRaises(SystemExit) as raised:
                render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertEqual(str(raised.exception.code),
                         "groups.json: defect L1 is in both 'Covers' and 'Thumbnails'")

    def test_report_exits_naming_a_grouped_line_that_is_not_a_defect(self):  # AC4
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high"}, note="the cover never loaded"),
                row("2026-08-28T10:00:11Z", "agent-1", "anomaly", seq=2,
                    params={"severity": "low", "kind": "issue"}, note="the picker was slow"),
            ])
            write_groups(d, defects=[{"title": "Covers", "lines": [1, 2]}])
            with self.assertRaises(SystemExit) as raised:
                render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertEqual(str(raised.exception.code),
                         "groups.json: 'Covers' lists L2, which is not a defect")

    def test_report_exits_naming_an_issue_when_groups_json_omits_its_side(self):  # AC4
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high"}, note="the cover never loaded"),
                row("2026-08-28T10:00:11Z", "agent-1", "anomaly", seq=2,
                    params={"severity": "low", "kind": "issue"}, note="the picker was slow"),
            ])
            write_groups(d, defects=[{"title": "Covers", "lines": [1]}])
            with self.assertRaises(SystemExit) as raised:
                render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertEqual(str(raised.exception.code),
                         "groups.json: execution issue L2 is in no group")

    def test_report_lists_every_defect_under_ungrouped_without_a_groups_file(self):  # AC5
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "anomaly", seq=1,
                    params={"severity": "high"}, note="the cover never loaded"),
            ])
            text = doc(render("r-tmp", "--journal-dir", tmp, "--no-server-log"), "defects.md")
        self.assertIn("## Ungrouped\n\n| # | Priority | Description | Agent |\n|---:|---|---|---|\n"
                      "| 1 | high | the cover never loaded (`L1`) | agent-1 |", text)

    def test_report_summary_gives_each_server_log_shape_one_line(self):
        text = doc(render(CROSS, "--server-log", str(FIXTURES / CROSS / "server.log")),
                   "report.md")
        self.assertIn("- `ERROR` 500 POST /api/rpc/merge-books/undo — 1 occurrence", text)
        self.assertNotIn("**Attributed to**", text)

    def test_report_summary_links_to_every_file_it_wrote(self):  # AC2
        with tempfile.TemporaryDirectory() as tmp:
            write_journal(Path(tmp) / "r-tmp", "r-tmp", [
                row("2026-08-28T10:00:00Z", "agent-1", "flow.start", seq=1),
                row("2026-08-28T10:00:20Z", "agent-1", "flow.end", seq=2,
                    params={"verdict": "pass"}),
            ])
            summary = render_files(tmp, "r-tmp", "--no-server-log")["report.md"]
            run_dir = Path(tmp) / "r-tmp"
        self.assertIn(f"- Summary — `{run_dir / 'report.md'}`\n"
                      f"- Defects — `{run_dir / 'defects.md'}`\n"
                      f"- Execution defects — `{run_dir / 'execution-defects.md'}`\n"
                      f"- Timeline — `{run_dir / 'timeline.md'}`", summary)

    def test_report_summary_counts_unverifiable_writes_by_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "r-tmp"
            write_journal(d, "r-tmp", [
                row("2026-08-28T10:00:10Z", "agent-1", "player.seek", seq=1, target=AUDIO),
                row("2026-08-28T10:00:11Z", "agent-1", "reader.close", seq=2, target=AUDIO),
                row("2026-08-28T10:00:12Z", "agent-1", "genre.edit", seq=3, target=AUDIO),
            ])
            (d / "audit.json").write_text(json.dumps({"run": "r-tmp", "checked": 0,
                "findings": [], "unverifiable": [
                    {"actor": "agent-1", "seq": 1, "why": "player.seek: no position recorded"},
                    {"actor": "agent-1", "seq": 2, "why": "reader.close: no position recorded"},
                    {"actor": "agent-1", "seq": 3, "why": "genre.edit: out of audit scope"},
                ]}))
            text = render("r-tmp", "--journal-dir", tmp, "--no-server-log")
        self.assertIn("3 writes the audit could not check, by reason:\n\n"
                      "- 2 × no position recorded (`player.seek`, `reader.close`)\n"
                      "- 1 × out of audit scope (`genre.edit`)", doc(text, "report.md"))
        self.assertIn("agent-1 `L1` — player.seek: no position recorded",
                      doc(text, "timeline.md"))

    def test_report_prints_every_file_under_its_own_header_to_stdout(self):
        text = render(CLEAN, "--no-server-log")
        headers = [line for line in text.splitlines() if line.startswith("==> ")]
        self.assertEqual(headers, ["==> report.md <==", "==> defects.md <==",
                                   "==> execution-defects.md <==", "==> timeline.md <=="])


class FormattingTests(unittest.TestCase):
    def test_clip_escapes_pipes_so_a_table_cell_cannot_break_the_table(self):
        self.assertEqual(report.clip("a | b", 40), "a \\| b")

    def test_clip_collapses_newlines_that_would_split_a_row(self):
        self.assertEqual(report.clip("a\nb\n c", 40), "a b c")

    def test_clip_truncates_with_an_ellipsis(self):
        self.assertEqual(report.clip("abcdef", 4), "abc…")

    def test_fmt_duration_reads_as_a_human_would_say_it(self):
        self.assertEqual(correlate.fmt_duration(timedelta(seconds=42)), "42s")
        self.assertEqual(correlate.fmt_duration(timedelta(seconds=3220)), "53m 40s")
        self.assertEqual(correlate.fmt_duration(timedelta(seconds=7300)), "2h 1m")

    def test_fmt_delta_always_carries_its_sign(self):
        self.assertEqual(correlate.fmt_delta(3.24), "+3.2s")
        self.assertEqual(correlate.fmt_delta(-30.5), "-30.5s")

    def test_parse_ts_normalises_to_utc(self):
        self.assertEqual(
            correlate.parse_ts("2026-08-28T18:00:00.000Z"),
            datetime(2026, 8, 28, 18, 0, tzinfo=timezone.utc),
        )

    def test_upper_first_leaves_the_rest_of_the_sentence_alone(self):
        self.assertEqual(report.upper_first("the `API` was fine"), "The `API` was fine")

    def test_join_phrases_uses_semicolons_once_a_clause_holds_a_comma(self):
        self.assertEqual(report.join_phrases(["a"]), "a")
        self.assertEqual(report.join_phrases(["a", "b"]), "a, and b")
        self.assertEqual(report.join_phrases(["a", "b", "c"]), "a; b; and c")


if __name__ == "__main__":
    unittest.main(verbosity=2)
