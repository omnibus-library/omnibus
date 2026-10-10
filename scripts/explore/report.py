#!/usr/bin/env python3
"""Render one exploration run as a summary and the files it points to.

Usage:
  report.py <run-id> [--out DIR|-] [--groups PATH] [--server-log PATH ...] [--no-server-log]

Writes four files into the run directory: `report.md` (the summary a human reads
first), `defects.md` and `execution-defects.md` (the runner's groups from
`groups.json`, then every row), and `timeline.md` (the server-log joins and the
merged journal). Without `groups.json` every row is listed as ungrouped.

The report is the run's only output — nothing here files a bug, opens an issue,
or gates anything. That makes terseness the whole design constraint: a document
padded with sections that say "none" is one nobody reads, and a report nobody
reads is worth less than no report at all. So a section with nothing in it is
**omitted**, not rendered empty, and a clean run's verdict is one paragraph.

**Nothing here decides what counts as a defect.** An anomaly's severity is the
word the agent wrote, rendered verbatim; a server line is surfaced because the
server logged it at WARN or answered non-2xx, not because this code judged the
behaviour. Do not add a rule that classifies a particular app behaviour — the
app changes deliberately (a clock that rescales with playback speed is a current
example), and a classifier here would outlive the behaviour it was written for
and emit a false positive on every run thereafter.

The one thing that is never omitted is a caveat. If the server log could not be
read, or the audit did not run, the verdict says so in the same breath as it
says "clean" — an absent input must never be reported as a passing check.

Reads the journal (and `audit.json`, when #2202 has written one) from
`$OMNIBUS_EXPLORE_JOURNAL_DIR/<run-id>/`, and the server's JSON log sink off the
instance over ssh. Correlation lives in correlate.py.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from correlate import (  # noqa: E402
    SEVERITY_ORDER,
    Attribution,
    Audit,
    LogGroup,
    Run,
    fetch_server_log,
    fmt_delta,
    fmt_duration,
    group_and_attribute,
    load_audit,
    load_journal,
    ranked_anomalies,
    read_server_log,
    severity_rank,
)

DETAIL_DEFAULT = "medium"
OUTPUT_FILES = (("Summary", "report.md"), ("Defects", "defects.md"),
                ("Execution defects", "execution-defects.md"), ("Timeline", "timeline.md"))
TABLE_CLIP = 140
DETAIL_CLIP = 1200
# A summary row is a pointer to the detail block, not a substitute for it —
# start.md asks agents for at most two short sentences, and this is the cap
# that keeps one that ran long from pushing the rest of the table off-screen.
DESCRIPTION_CLIP = 200

# What to expand under an anomaly, and the param names agents actually use for
# each. `start.md` pins only `severity`, `expected` and `observed`; the rest is
# vocabulary agents invented, so each label takes the first key it finds rather
# than one spelling — across run r-20260828-02 the same field arrived as both
# `repro` and `reproduce`, and as both `where` and `surface`.
DETAIL_FIELDS = (
    ("Expected", ("expected",)),
    ("Observed", ("observed",)),
    ("Repro", ("repro", "reproduce")),
    ("Where", ("where", "surface", "element")),
    ("Impact", ("impact", "why_it_matters")),
    ("Caveat", ("caveat", "checked_and_dismissed")),
)


def clip(text, limit: int) -> str:
    """One-line, pipe-safe, length-capped — markdown table cells are unforgiving."""
    s = " ".join(str(text if text is not None else "").split()).replace("|", "\\|")
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def hhmmss(entry_or_ts) -> str:
    ts = getattr(entry_or_ts, "ts", entry_or_ts)
    return ts.strftime("%H:%M:%S")


def plural(n: int, singular: str, many: str | None = None) -> str:
    return f"{n} {singular if n == 1 else (many or singular + 's')}"


@dataclass(frozen=True)
class Source:
    """An input's one-line status, plus the caveat it owes the verdict.

    A missing input is not a passing check. Anything that could not be read
    carries a `caveat`, and the verdict paragraph is required to say it in the
    same breath as whatever it concludes.
    """

    headline: str
    caveat: str | None = None


@dataclass(frozen=True)
class Group:
    """One group of anomaly rows the runner judged to share a cause (`groups.json`)."""

    title: str
    root_cause: str
    checked: bool
    lines: tuple[int, ...]


def load_groups(path: Path) -> dict[str, list[Group]]:
    """Read `groups.json` into its `defects` / `execution` sides — each only if present."""
    data = json.loads(path.read_text())
    return {
        side: [Group(g["title"], g.get("root_cause", ""), bool(g.get("checked")),
                     tuple(g["lines"])) for g in data[side]]
        for side in ("defects", "execution") if side in data
    }


def worst_severity(group: Group, rows: list) -> str:
    """The most severe severity among a group's rows."""
    members = [a for a in rows if a.line in group.lines]
    return min(members, key=lambda a: severity_rank(a.severity)).severity


def split_why(why: str) -> tuple[str | None, str]:
    """`player.seek: no position recorded` → (`player.seek`, `no position recorded`)."""
    action, sep, reason = why.partition(": ")
    if sep and reason and " " not in action:
        return action, reason
    return None, why


def check_groups(groups: list[Group], rows: list, noun: str) -> None:
    """Exit naming the first row the grouping misplaces: each belongs to exactly one group."""
    lines = {a.line for a in rows}
    grouped: dict[int, str] = {}
    for g in groups:
        for line in g.lines:
            if line not in lines:
                sys.exit(f"groups.json: '{g.title}' lists L{line}, which is not a {noun}")
            if line in grouped:
                sys.exit(f"groups.json: {noun} L{line} is in both "
                         f"'{grouped[line]}' and '{g.title}'")
            grouped[line] = g.title
    for a in rows:
        if a.line not in grouped:
            sys.exit(f"groups.json: {noun} L{a.line} is in no group")


def when_same(group) -> bool:
    return group.count == 1 or group.first.ts.replace(microsecond=0) == group.findings[-1].ts.replace(microsecond=0)


def join_phrases(parts: list[str]) -> str:
    """Join clauses that themselves contain commas, so a reader can parse them."""
    parts = [p for p in parts if p]
    if len(parts) <= 1:
        return "".join(parts)
    if len(parts) == 2:
        return f"{parts[0]}, and {parts[1]}"
    return "; ".join(parts[:-1]) + "; and " + parts[-1]


def oxford(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def upper_first(text: str) -> str:
    """Capitalise the first letter only — `str.capitalize` lowercases the rest."""
    return text[:1].upper() + text[1:]


def severity_breakdown(rows) -> str:
    """`2 high, 1 low` — each severity's count, worst first."""
    counts: dict[str, int] = {}
    for a in rows:
        counts[a.severity] = counts.get(a.severity, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: severity_rank(kv[0]))
    return ", ".join(f"{n} {k}" for k, n in ranked)


# Worst first, so the verdict leads with the flows that went wrong.
VERDICT_ORDER = ["fail", "uncertain", "unclosed", "unstated", "pass"]


class Report:
    """Assembles the markdown. Sections append themselves only when non-empty."""

    def __init__(self, run: Run, args, audit: Audit | None, audit_src: Source,
                 groups: list[LogGroup], log_src: Source,
                 row_groups: dict[str, list[Group]] | None = None):
        self.run = run
        self.row_groups = row_groups or {}
        self.args = args
        self.audit = audit
        self.audit_src = audit_src
        self.groups = groups
        self.log_src = log_src
        self.spans = run.spans()
        self.anomalies = ranked_anomalies(run)
        # Split on the agent's own `kind`, worst-first within each. Two tables,
        # because "the app is wrong" and "this was slow or unverifiable" are
        # read by different people for different reasons, and a single ranked
        # list buries the first kind under the second on a friction-heavy run.
        self.defect_rows = [a for a in self.anomalies if a.kind == "defect"]
        self.issue_rows = [a for a in self.anomalies if a.kind == "issue"]
        for side, noun, rows in (("defects", "defect", self.defect_rows),
                                 ("execution", "execution issue", self.issue_rows)):
            if side in self.row_groups:
                check_groups(self.row_groups[side], rows, noun)
        self.out: list[str] = []

    # ---------- facts the verdict and the sections both need ----------

    def verdict_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for s in self.spans:
            counts[s.verdict] = counts.get(s.verdict, 0) + 1
        return counts

    @property
    def failed_flows(self) -> int:
        return self.verdict_counts().get("fail", 0)

    @property
    def unclosed_flows(self) -> int:
        return self.verdict_counts().get("unclosed", 0)

    @property
    def orphan_ends(self) -> list:
        return [s for s in self.spans if s.start is None]

    @property
    def log_findings(self) -> int:
        return sum(g.count for g in self.groups)

    def is_clean(self) -> bool:
        """Clean means every check ran and every check passed — not 'nothing found'.

        A journal with no flow in it is therefore not clean: nothing was checked,
        which is a different statement from nothing being wrong.
        """
        if not self.spans:
            return False
        return not (
            self.anomalies
            or self.failed_flows
            or self.unclosed_flows
            or self.orphan_ends
            or self.groups
            or self.run.malformed
            or self.run.foreign_runs
            or (self.audit and (self.audit.findings or self.audit.unverifiable))
        )

    def is_aborted(self) -> bool:
        """A run that stopped rather than finished, however few entries it left."""
        if self.failed_flows and not self.verdict_counts().get("pass"):
            return True
        return bool(self.orphan_ends) and not self.verdict_counts().get("pass")

    # ---------- rendering ----------

    def add(self, *lines: str) -> None:
        self.out.extend(lines)

    def documents(self) -> dict[str, str]:
        """Every file the run's output is split into, keyed by file name."""
        return {
            "report.md": self.compose(
                self.header, self.verdict, self.citations, self.coverage, self.defects,
                self.execution_issues, self.server_log_summary, self.audit_section,
                self.integrity, self.journal_files),
            "defects.md": self.compose(lambda: self.rows_file(
                "Defects", "Defect", self.defect_rows, self.row_groups.get("defects"))),
            "execution-defects.md": self.compose(lambda: self.rows_file(
                "Execution issues", "Issue", self.issue_rows, self.row_groups.get("execution"))),
            "timeline.md": self.compose(lambda: self.title("Timeline"), self.server_log,
                                        self.unverifiable_list, self.timeline),
        }

    def rows_file(self, what: str, label: str, rows: list, groups: list[Group] | None) -> None:
        """A detail file: its groups first when the runner wrote them, then every row."""
        self.title(what)
        if groups is None:
            self.anomaly_table("Ungrouped", rows)
        else:
            numbers = {a.line: i for i, a in enumerate(rows, start=1)}
            ranked = self.rank_groups(groups, rows)
            self.group_table(ranked, rows, numbers)
            self.grouped_row_table(f"All {what[:1].lower()}{what[1:]}", rows, ranked)
        self.detail(label, rows)

    @staticmethod
    def rank_groups(groups: list[Group], rows: list) -> list[Group]:
        """Worst member first, then the larger group — the order a reader triages in."""
        return sorted(groups, key=lambda g: (severity_rank(worst_severity(g, rows)),
                                             -len(g.lines), g.title))

    def group_table(self, groups: list[Group], rows: list, numbers: dict[int, int]) -> None:
        self.add("## Groups", "", "| G | Group | Priority | Rows | Root cause | Checked |",
                 "|---:|---|---|---|---|---|")
        for gi, g in enumerate(groups, start=1):
            members = ", ".join(str(n) for n in sorted(numbers[line] for line in g.lines))
            self.add(f"| {gi} | {clip(g.title, TABLE_CLIP)} | {worst_severity(g, rows)} | "
                     f"{members} | {clip(g.root_cause, DETAIL_CLIP)} | "
                     f"{'✅' if g.checked else '—'} |")
        self.add("")

    def grouped_row_table(self, title: str, rows: list, groups: list[Group]) -> None:
        group_of = {line: gi for gi, g in enumerate(groups, start=1) for line in g.lines}
        self.add(f"## {title}", "", "| # | Priority | Description | Agent | Group |",
                 "|---:|---|---|---|---|")
        for i, a in enumerate(rows, start=1):
            self.add(f"{self.row_cells(i, a)} G{group_of[a.line]} |")
        self.add("")

    def compose(self, *sections) -> str:
        self.out = []
        for section in sections:
            section()
        return "\n".join(self.out).rstrip() + "\n"

    def title(self, what: str) -> None:
        self.add(f"# {what} — run {self.run.run_id}", "")

    def header(self) -> None:
        run = self.run
        url = run.base_url or self.args.base_url or os.environ.get("OMNIBUS_EXPLORE_URL") or "unknown"
        self.add(
            f"# Exploration run {run.run_id}",
            "",
            "| | |",
            "|---|---|",
            f"| Instance | {url} |",
            f"| Started | {run.started:%Y-%m-%d %H:%M:%S} UTC |",
            f"| Ended | {run.ended:%Y-%m-%d %H:%M:%S} UTC |",
            f"| Duration | {fmt_duration(run.duration)} |",
            f"| Agents | {', '.join(run.actors)} |",
            f"| Journal | `{run.path}` ({plural(len(run.entries), 'entry', 'entries')}) |",
            f"| Server log | {self.log_src.headline} |",
            f"| Audit | {self.audit_src.headline} |",
            "",
        )

    def verdict(self) -> None:
        """AC3 lives here: the first paragraph is the whole answer for a clean run."""
        run = self.run
        scale = (
            f"{plural(len(run.actors), 'agent')} ran {plural(len(self.spans), 'flow')} "
            f"over {fmt_duration(run.duration)}, {plural(len(run.entries), 'journal entry', 'journal entries')}."
        )
        caveats = [c for c in (self.log_src.caveat, self.audit_src.caveat) if c]

        if self.is_clean() and not caveats:
            self.add(
                f"**Clean run.** {scale} No anomalies, every flow ended `pass`, the audit "
                f"confirmed all {self.audit.checked if self.audit else 0} writes it checked, and "
                f"the server logged nothing above INFO and no non-2xx response in the window.",
                "",
            )
            return

        parts = []
        vc = self.verdict_counts()
        flow_bits = [f"{vc[k]} `{k}`" for k in VERDICT_ORDER if k != "pass" and vc.get(k)]
        flow_bits += [f"{n} `{k}`" for k, n in sorted(vc.items())
                      if k not in VERDICT_ORDER]
        if flow_bits:
            odd = sum(n for k, n in vc.items() if k != "pass")
            parts.append(f"{oxford(flow_bits)} {'flow' if odd == 1 else 'flows'}")
        if self.groups:
            parts.append(f"{plural(self.log_findings, 'server-log finding')} in "
                         f"{plural(len(self.groups), 'distinct shape')}")
        if self.audit and self.audit.findings:
            parts.append(f"{plural(len(self.audit.findings), 'write')} the audit could not "
                         f"confirm, of {self.audit.checked} checked")
        if self.run.malformed:
            parts.append(plural(len(self.run.malformed), "unparseable journal line"))
        if self.run.foreign_runs:
            parts.append("journal lines belonging to another run")

        if self.is_aborted():
            lead = "**Run aborted.**"
            if self.anomalies:
                parts.insert(0, self.anomaly_phrase())
        elif self.anomalies:
            lead = f"**{upper_first(self.anomaly_phrase())}.**"
        else:
            lead = "**No findings.**"

        body = f"{lead} {scale}"
        if parts:
            body += " Also: " + join_phrases(parts) + "."
        if caveats:
            body += " " + upper_first(join_phrases(caveats)) + "."
        self.add(" ".join(body.split()), "")

    def citations(self) -> None:
        """After the verdict, not before it — the verdict is the first paragraph."""
        self.add(
            f"Citations read `L<n>` — line *n* of that journal. "
            f"`sed -n '<n>p' {self.run.path}` prints the line to replay from.",
            "",
        )

    def anomaly_phrase(self) -> str:
        return (f"{plural(len(self.anomalies), 'anomaly', 'anomalies')} "
                f"({severity_breakdown(self.anomalies)})")

    def coverage(self) -> None:
        """What the run actually covered — the evidence behind the verdict."""
        self.add("## Coverage", "", "| Agent | Flows | Entries | Anomalies | Verdicts |",
                 "|---|---:|---:|---:|---|")
        for actor in self.run.actors:
            spans = [s for s in self.spans if s.actor == actor]
            entries = [e for e in self.run.entries if e.actor == actor]
            anom = [e for e in entries if e.action == "anomaly"]
            verdicts: dict[str, int] = {}
            for s in spans:
                verdicts[s.verdict] = verdicts.get(s.verdict, 0) + 1
            flows = ", ".join(sorted({s.flow for s in spans})) or "—"
            vs = ", ".join(f"{n}×`{k}`" for k, n in sorted(verdicts.items())) or "—"
            self.add(f"| {actor} | {clip(flows, 80)} | {len(entries)} | {len(anom)} | {vs} |")
        self.add("")

    def defects(self) -> None:
        """What the agents say is wrong with the app."""
        self.row_summary("Defects", "defect", self.defect_rows, "defects.md",
                         self.row_groups.get("defects"))

    def execution_issues(self) -> None:
        """Friction the agents hit while running — a control that responded
        slowly, a step they could not validate, a step that took far longer
        than it should. Reportable, but not a claim that the app is wrong.
        """
        self.row_summary("Execution issues", "execution issue", self.issue_rows,
                         "execution-defects.md", self.row_groups.get("execution"))

    def row_summary(self, title: str, noun: str, rows: list, file: str,
                    groups: list[Group] | None) -> None:
        """The summary's pointer to a detail file: its groups, never the rows themselves."""
        if not rows:
            return
        counted = f"{plural(len(rows), noun)} ({severity_breakdown(rows)})"
        if groups is None:
            self.add(f"## {title}", "", f"{counted}, **not grouped** — no `groups.json` beside "
                                        f"the journal. Every row is in `{file}`.", "")
            return
        self.add(f"## {title}", "",
                 f"{counted} in {plural(len(groups), 'group')}. Every row is in `{file}`.", "",
                 "| G | Group | Priority | Rows |", "|---:|---|---|---:|")
        for gi, g in enumerate(self.rank_groups(groups, rows), start=1):
            self.add(f"| {gi} | {clip(g.title, TABLE_CLIP)} | {worst_severity(g, rows)} | "
                     f"{len(g.lines)} |")
        self.add("")

    def anomaly_table(self, title: str, rows: list) -> None:
        """AC2: every row cites the journal line needed to reproduce it."""
        if not rows:
            return
        self.add(f"## {title}", "",
                 "| # | Priority | Description | Agent |",
                 "|---:|---|---|---|")
        for i, a in enumerate(rows, start=1):
            self.add(self.row_cells(i, a))
        self.add("")

    @staticmethod
    def row_cells(i: int, a) -> str:
        """`| # | Priority | Description | Agent |` — the description cites its journal line."""
        summary = a.note or a.params.get("observed") or a.params.get("expected") or ""
        return (f"| {i} | {a.severity} | {clip(summary, DESCRIPTION_CLIP)} "
                f"(`L{a.line}`) | {a.actor} |")

    def detail(self, label: str, rows: list) -> None:
        """Expand each row at or above `--detail-severity`, numbered as in its table."""
        cut = severity_rank(self.args.detail_severity)
        shown = [(i, a) for i, a in enumerate(rows, start=1) if severity_rank(a.severity) <= cut]
        if not shown:
            return
        self.add(f"### Detail — {self.args.detail_severity} and above", "")
        for i, a in shown:
            self.add(f"#### {label} {i}. `{a.severity}` · {a.actor} · {a.flow} · "
                     f"{hhmmss(a)} · `L{a.line}`", "")
            if a.target:
                self.add(f"- **Target** `{a.target}`")
            for field, keys in DETAIL_FIELDS:
                value = next((a.params[k] for k in keys if a.params.get(k)), None)
                if value:
                    self.add(f"- **{field}** {clip(value, DETAIL_CLIP)}")
            if a.note:
                self.add(f"- **Note** {clip(a.note, DETAIL_CLIP)}")
            self.add(f"- **Replay** `sed -n '{a.line}p' {self.run.path}`", "")

    def server_log_summary(self) -> None:
        """One line per log shape; the joins to agent actions live in timeline.md."""
        if not self.groups:
            return
        self.add("## Server log", "",
                 f"{plural(self.log_findings, 'finding')} in "
                 f"{plural(len(self.groups), 'distinct shape')}. Each is joined to the action "
                 "that caused it in `timeline.md`.", "")
        for g in self.groups:
            self.add(f"- `{g.first.level}` {clip(g.first.headline, 110)} — "
                     f"{plural(g.count, 'occurrence')}")
        self.add("")

    def server_log(self) -> None:
        """AC4: each finding is joined to an agent action, not appended in a heap."""
        if not self.groups:
            return
        self.add("## Server log", "",
                 f"Correlated against the journal within ±{int(self.args.window)}s — "
                 "identity (a book uuid shared with a journal `target`) beats proximity, "
                 "and the signed offset is shown so the join stays checkable.", "")
        for g in self.groups:
            f = g.first
            last = hhmmss(g.findings[-1].ts)
            when = hhmmss(f.ts) if when_same(g) else f"{hhmmss(f.ts)}–{last}"
            self.add(f"### {'PANIC · ' if f.is_panic else ''}{clip(f.headline, 110)}", "")
            self.add(f"- **When** {when} · {plural(g.count, 'occurrence')} · "
                     f"`{f.level}` from `{f.target}`")
            if f.subtitle:
                self.add(f"- **Message** {clip(f.subtitle, 400)}")
            if f.detail:
                self.add(f"- **Fields** `{clip(f.detail, 300)}`")
            if not f.request_scoped:
                self.add("- **Attribution** none possible — no request span, so this is "
                         "process-level (boot, background task) rather than an agent's action.")
            else:
                self.add(f"- **Attributed to** {g.primary.cite}")
                self.render_context(g.primary)
                if g.count > 1:
                    spread = ", ".join(f"{k}×{v}" for k, v in g.actors.items())
                    self.add(f"- **Across occurrences** {spread}")
            self.add("")

    def render_context(self, attr: Attribution) -> None:
        if attr.in_flight:
            self.add("- **In flight** " + " · ".join(f"{a} {f}" for a, f in attr.in_flight))
        if attr.neighbours:
            others = " · ".join(
                f"{e.actor} `L{e.line}` `{e.action}` {fmt_delta(d)}"
                for e, d in attr.neighbours
            )
            self.add(f"- **Other actors nearby** {others}")

    def audit_section(self) -> None:
        a = self.audit
        if a is None or not (a.findings or a.unverifiable):
            return
        self.add("## Audit reconciliation", "")
        if a.run and a.run != self.run.run_id:
            self.add(f"> ⚠️ `audit.json` names run `{a.run}`, not `{self.run.run_id}`. "
                     "The rows below may describe a different run.", "")
        self.add(f"{a.checked} journalled writes checked"
                 + (f" against baseline `{a.baseline_snapshot}`" if a.baseline_snapshot else "")
                 + ".", "")
        if a.findings:
            self.add("| Kind | Agent | What | Target | Expected | Observed | Replay |",
                     "|---|---|---|---|---|---|---|")
            for f in a.findings:
                seq = f.get("replay_from", f.get("seq"))
                line = self.run.line_of(str(f.get("actor")), seq) if isinstance(seq, int) else None
                cite = f"`L{line}` (seq {seq})" if line else (f"seq {seq}" if seq is not None else "—")
                self.add(
                    f"| {clip(f.get('kind'), 20)} | {clip(f.get('actor'), 20)} | "
                    f"{clip(f.get('what'), 30)} | {'`' + clip(f.get('target'), 40) + '`' if f.get('target') else '—'} | "
                    f"{clip(f.get('expected'), 90)} | {clip(f.get('observed'), 90)} | {cite} |"
                )
            self.add("")
        if a.unverifiable:
            self.add(f"{plural(len(a.unverifiable), 'write')} the audit could not check, "
                     "by reason:", "")
            tally: dict[str, tuple[int, list[str]]] = {}
            for u in a.unverifiable:
                action, reason = split_why(str(u.get("why") or ""))
                count, actions = tally.get(reason, (0, []))
                if action and action not in actions:
                    actions.append(action)
                tally[reason] = (count + 1, actions)
            for reason, (count, actions) in sorted(tally.items(), key=lambda kv: -kv[1][0]):
                listed = f" ({', '.join(f'`{x}`' for x in actions)})" if actions else ""
                self.add(f"- {count} × {clip(reason, 200)}{listed}")
            self.add("")

    def unverifiable_list(self) -> None:
        """Every write the audit declined to judge, one line each, cited by journal line."""
        a = self.audit
        if a is None or not a.unverifiable:
            return
        self.add("## Audit — writes not checked", "")
        for u in a.unverifiable:
            seq = u.get("seq")
            line = self.run.line_of(str(u.get("actor")), seq) if isinstance(seq, int) else None
            cite = f"`L{line}`" if line else f"seq {seq}"
            self.add(f"- {u.get('actor')} {cite} — {clip(u.get('why'), 200)}")
        self.add("")

    def integrity(self) -> None:
        """Flows that never opened, never closed, or closed badly."""
        odd = [s for s in self.spans if s.verdict != "pass"]
        if not odd and not self.run.malformed and not self.run.foreign_runs:
            return
        self.add("## Run integrity", "")
        if odd:
            self.add("| Agent | Flow | Started | Ended | Verdict | Journal | Reason |",
                     "|---|---|---|---|---|---|---|")
            for s in odd:
                reason = (s.end.params.get("reason") if s.end else None) or (
                    "the agent stopped mid-flow")
                # The structural note goes in the short verdict cell, not appended
                # to a reason long enough to be clipped away.
                verdict = f"`{s.verdict}`" + (" · never opened" if s.start is None else "")
                cite = f"`L{(s.end or s.start).line}`"
                self.add(
                    f"| {s.actor} | {s.flow} | {hhmmss(s.start) if s.start else '—'} | "
                    f"{hhmmss(s.end) if s.end else '—'} | {verdict} | {cite} | "
                    f"{clip(reason, TABLE_CLIP)} |"
                )
            self.add("")
        if self.run.malformed:
            self.add(f"- {plural(len(self.run.malformed), 'journal line')} could not be parsed: "
                     f"{', '.join(f'L{n}' for n in self.run.malformed[:20])}", "")
        if self.run.foreign_runs:
            self.add(f"- Lines from another run were present and skipped: "
                     f"{', '.join(sorted(self.run.foreign_runs))}", "")

    def timeline(self) -> None:
        """Collapsed on purpose: the record a reader wants only once they care."""
        if self.args.no_timeline:
            return
        self.add("## Timeline", "")
        self.add("<details><summary>Merged, all agents in clock order "
                 f"({len(self.run.entries)} entries)</summary>", "")
        self.add("| Time | Agent | Flow | Seq | Action | Target | Outcome | Journal |",
                 "|---|---|---|---:|---|---|---|---|")
        for e in self.run.entries:
            self.add(
                f"| {hhmmss(e)} | {e.actor} | {e.flow} | {e.seq if e.seq is not None else '—'} | "
                f"`{e.action}` | {('`' + e.target[:8] + '…`') if e.target else '—'} | "
                f"{e.outcome} | `L{e.line}` |"
            )
        self.add("", "</details>", "")
        for actor in self.run.actors:
            mine = [e for e in self.run.entries if e.actor == actor]
            self.add(f"<details><summary>{actor} — {len(mine)} entries</summary>", "")
            for e in mine:
                extra = f" — {clip(e.note, 160)}" if e.note else ""
                self.add(f"- `{hhmmss(e)}` `L{e.line}` **{e.action}** ({e.flow}, {e.outcome})"
                         f"{extra}")
            self.add("", "</details>", "")

    def journal_files(self) -> None:
        """Where the run's records are, in full, and always — this is the one
        section that is rendered even when it is the only thing to say.

        Every citation above is a line number in a file, and the report is read
        long after the session that produced it is gone. A reader who cannot
        find the journal cannot replay a single row.
        """
        run_dir = self.run.path.parent
        self.add("## Journal files", "",
                 f"- Run directory — `{run_dir}`",
                 f"- Journal — `{self.run.path}` "
                 f"({plural(len(self.run.entries), 'entry', 'entries')})")

        audit_path = self.args.audit or (run_dir / "audit.json")
        self.add(f"- Audit — `{audit_path}`" if Path(audit_path).is_file()
                 else f"- Audit — not written ({self.audit_src.headline})")

        if self.args.out != "-":
            out_dir = Path(self.args.out) if self.args.out else run_dir
            for label, name in OUTPUT_FILES:
                self.add(f"- {label} — `{out_dir / name}`")
        for path in self.args.server_log or []:
            self.add(f"- Server log — `{path}`")
        self.add("")


def load_env() -> None:
    """Pick up `OMNIBUS_EXPLORE_*` from the repo `.env`, without clobbering.

    Mirrors `explore::load_env` in lib.sh — an explicit env var always wins — so
    `report.py <run>` works from a checkout the same way the shell scripts do
    rather than needing its own export dance.
    """
    root = Path(__file__).resolve().parents[2]
    env = root / ".env"
    if not env.is_file():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line.startswith("OMNIBUS_EXPLORE_") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value)


def resolve_paths(args) -> tuple[Path, Path]:
    """Find the run's directory the same way owned.sh does.

    The in-tree fallback is deliberate but second: `.claude/runtime/` is
    per-worktree, so a journal left there is orphaned by the next `wt switch`.
    """
    repo = Path(__file__).resolve().parents[2]
    root = Path(
        args.journal_dir
        or os.environ.get("OMNIBUS_EXPLORE_JOURNAL_DIR")
        or repo / ".claude/runtime/explore"
    ).expanduser()
    run_dir = root / args.run
    journal = run_dir / "journal.jsonl"
    if not journal.is_file():
        sys.exit(f"no journal at {journal} — set OMNIBUS_EXPLORE_JOURNAL_DIR "
                 f"or pass --journal-dir")
    return run_dir, journal


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("run", help="run id, e.g. r-20260828-02")
    ap.add_argument("--journal-dir", default=None,
                    help="defaults to $OMNIBUS_EXPLORE_JOURNAL_DIR")
    ap.add_argument("--out", default=None, help="output directory, or - to print every "
                                                "file to stdout (default <run dir>)")
    ap.add_argument("--audit", type=Path, default=None,
                    help="audit.json to reconcile against (default <run dir>/audit.json)")
    ap.add_argument("--groups", type=Path, default=None,
                    help="the runner's groups.json (default <run dir>/groups.json)")
    ap.add_argument("--server-log", type=Path, action="append", default=[],
                    help="read a local JSON log file instead of fetching over ssh; repeatable")
    ap.add_argument("--no-server-log", action="store_true",
                    help="skip the log entirely — the report will say so")
    ap.add_argument("--window", type=float, default=90.0,
                    help="seconds either side of a log line to search for the action "
                         "that caused it (default 90)")
    ap.add_argument("--log-pad", type=float, default=120.0,
                    help="seconds of log to read either side of the run (default 120)")
    ap.add_argument("--detail-severity", default=DETAIL_DEFAULT,
                    help=f"lowest severity to expand in full (default {DETAIL_DEFAULT})")
    ap.add_argument("--no-timeline", action="store_true")
    ap.add_argument("--base-url", default=None,
                    help="instance URL, when no flow.start recorded one")
    args = ap.parse_args()
    if args.detail_severity not in SEVERITY_ORDER:
        sys.exit(f"--detail-severity must be one of {', '.join(SEVERITY_ORDER)}")
    load_env()

    run_dir, journal_path = resolve_paths(args)
    run = load_journal(journal_path, args.run)

    audit_path = args.audit or (run_dir / "audit.json")
    audit = None
    audit_src = Source(
        f"not run — no `{audit_path.name}` beside the journal",
        f"the audit **did not run** (no `{audit_path.name}` beside the journal)",
    )
    if audit_path.is_file():
        try:
            audit = load_audit(audit_path)
            audit_src = Source(f"`{audit_path}` — {audit.checked} writes checked")
        except (ValueError, OSError) as exc:
            audit_src = Source(f"unreadable — `{audit_path}`: {exc}",
                               f"the audit output **could not be read** ({exc})")

    pad = timedelta(seconds=args.log_pad)
    window = (run.started - pad, run.ended + pad)
    if args.no_server_log:
        findings = []
        log_src = Source("skipped (`--no-server-log`)",
                         "the server log was **not read** (`--no-server-log`)")
    elif args.server_log:
        findings = read_server_log(args.server_log, window)
        log_src = Source(", ".join(f"`{p}`" for p in args.server_log))
    else:
        findings, status = fetch_server_log(
            window,
            host=os.environ.get("OMNIBUS_EXPLORE_SSH_HOST", "applications"),
            remote_dir=os.environ.get("OMNIBUS_EXPLORE_REMOTE_DIR", "omnibus-main"),
            log_dir=os.environ.get("OMNIBUS_EXPLORE_REMOTE_LOG_DIR", "cache/data/logs"),
        )
        log_src = Source(status, f"the server log was **not read** ({status})"
                         if status.startswith("unavailable") else None)
    groups = group_and_attribute(findings, run, args.window)
    groups_path = args.groups or run_dir / "groups.json"
    row_groups = load_groups(groups_path) if groups_path.is_file() else {}

    docs = Report(run, args, audit, audit_src, groups, log_src, row_groups).documents()
    if args.out == "-":
        sys.stdout.write("\n".join(f"==> {name} <==\n{text}" for name, text in docs.items()))
        return
    out_dir = Path(args.out) if args.out else run_dir
    for name, text in docs.items():
        (out_dir / name).write_text(text)
        print(f"wrote {out_dir / name} ({len(text.splitlines())} lines)")


if __name__ == "__main__":
    main()
