#!/usr/bin/env python3
"""Draw the flow sequence for an exploration run.

The agent never samples — see "you never sample anything yourself" in
docs/qa/agentic_exploration/start.md. An LLM told "pick a flow at random" will
not produce a uniform draw; it will produce the same three flows every time.
So the runner owns the dice and hands over one flow at a time.

Every top-level flow is equally likely. There is no weight column: the run
is looking for defects, not modelling how often a reader does something, and
a weighted draw over a distinct sample mostly decided which low-weight flows
never ran at all. A subflow always runs inside its parent, for the same
reason: a roll that skips it is a roll that skips a check.

The catalog table in flows/README.md is the single source of truth for which
flows exist, which parent a subflow runs inside, and which flows another is
drawn after; each flow's own doc says which surfaces it runs on. The parser is
deliberately strict: if the table or a doc cannot be read, or a cell names a
flow that is not in the catalog, this exits non-zero rather than silently
drawing from a catalog nobody intended.

`--exclude` drops flows (top-level or subflow) for every agent, `--exclude-for`
for one, and `--ios` adds one agent drawn only from flows whose doc lists iOS.
Every exclusion is emitted with its reason, so no cut reads as coverage.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROW = re.compile(r"^\|\s*\[([a-z_]+)\]\(([^)]+)\)\s*\|")
TOP = "on its own"
INSIDE = re.compile(r"^inside\s+([a-z_]+)$")
NONE = "—"
SURFACES = re.compile(r"^\|\s*\*\*Surfaces\*\*\s*\|(.*)\|\s*$")
IOS = re.compile(r"\bios\b", re.IGNORECASE)
EXCLUDE_FOR = re.compile(r"^(agent-\d+)=(.+)$")


@dataclass
class Catalog:
    flows: list[str]
    top: list[str]
    subs: dict[str, list[str]]
    ios: set[str]
    after: dict[str, list[str]]


def surfaces(name: str, doc: Path) -> str:
    if not doc.is_file():
        sys.exit(f"catalog links {name} to {doc}, which does not exist")
    for line in doc.read_text().splitlines():
        if m := SURFACES.match(line):
            return m.group(1)
    sys.exit(f"{doc} has no '| **Surfaces** | … |' row — the iOS agent's pool is read from it")


def parse_catalog(path: Path) -> Catalog:
    flows: list[str] = []
    top: list[str] = []
    subs: dict[str, list[str]] = {}
    ios: set[str] = set()
    after: dict[str, list[str]] = {}
    for line in path.read_text().splitlines():
        m = ROW.match(line)
        if not m:
            continue
        name = m.group(1)
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 4:
            sys.exit(f"catalog row for {name} has {len(cells)} cells, expected "
                     f"Flow | Runs | Owner-only | Drawn after — fix {path}")
        runs, drawn_after = cells[1], cells[3]
        flows.append(name)
        if runs == TOP:
            top.append(name)
        elif inside := INSIDE.match(runs):
            subs.setdefault(inside.group(1), []).append(name)
        else:
            sys.exit(f"unparseable 'Runs' cell in catalog for {name}: {runs!r}")
        if drawn_after != NONE:
            after[name] = [s.strip() for s in drawn_after.split(",")]
        if IOS.search(surfaces(name, path.parent / m.group(2))):
            ios.add(name)

    if not top:
        sys.exit(f"no top-level flows parsed from {path} — has the table format changed?")
    for parent in subs:
        if parent not in top:
            sys.exit(f"subflow parent {parent!r} is not a top-level flow — fix {path}")
    for name, deps in after.items():
        for flow in [name, *deps]:
            if flow not in top:
                sys.exit(f"'Drawn after' for {name} names {flow!r}, which is not a "
                         f"top-level flow — fix {path}")
    return Catalog(flows, top, subs, ios, after)


def order(picked: list[str], after: dict[str, list[str]]) -> list[str]:
    """Move a flow drawn before any of its 'Drawn after' flows to just after the last."""
    seq = list(picked)
    for name, deps in after.items():
        drawn = [seq.index(d) for d in deps if d in seq]
        # Already late is left alone: moving it forward would read back less.
        if name in seq and drawn and seq.index(name) < max(drawn):
            seq.remove(name)
            seq.insert(max(seq.index(d) for d in deps if d in seq) + 1, name)
    return seq


def draw(top, subs, after, count, rng, first=None):
    """Draw `count` distinct flows, uniformly. `first` is forced to the front."""
    pool = list(top)
    picked: list[str] = []
    if first:
        if first not in pool:
            sys.exit(f"--first {first} is not a top-level flow")
        picked.append(first)
        pool.remove(first)
    picked.extend(rng.sample(pool, min(count - len(picked), len(pool))))

    return [
        {"flow": name, "subflows": list(subs.get(name, []))}
        for name in order(picked, after)
    ]


def flow_list(value: str, catalog: Catalog, flag: str) -> list[str]:
    names = [s.strip() for s in value.split(",") if s.strip()]
    for name in names:
        # A typo'd name must not become a silent no-op.
        if name not in catalog.flows:
            sys.exit(f"{flag}: {name!r} is not a flow in the catalog")
    return list(dict.fromkeys(names))


def agent_exclusions(args, catalog: Catalog, actors, excluded) -> dict[str, dict[str, str]]:
    """Each agent's own exclusions, flow -> reason; run-wide ones are reported once, at the top."""
    cuts = {
        actor: {f: "surface ios" for f in catalog.flows
                if surface == "ios" and f not in catalog.ios and f not in excluded}
        for actor, surface in actors
    }
    for spec in args.exclude_for:
        m = EXCLUDE_FOR.match(spec)
        if not m:
            sys.exit(f"--exclude-for {spec!r}: expected agent-K=flow1,flow2")
        actor = m.group(1)
        if actor not in cuts:
            sys.exit(f"--exclude-for: {actor} is not an agent in this run "
                     f"({', '.join(cuts)})")
        for name in flow_list(m.group(2), catalog, "--exclude-for"):
            if name not in excluded:
                cuts[actor].setdefault(name, "--exclude-for")
    return cuts


def main() -> None:
    ap = argparse.ArgumentParser()
    # Matches the default the skill's argument table shows the user, so the
    # two cannot drift into disagreeing about what a bare run means.
    ap.add_argument("--agents", type=int, default=2)
    ap.add_argument("--flows-per-agent", type=int, default=4)
    ap.add_argument("--seed", type=int, default=None,
                    help="omit to draw one; the seed used is always emitted, "
                         "and re-running with it reproduces the draw exactly")
    ap.add_argument("--run", required=True)
    ap.add_argument("--catalog", type=Path,
                    default=Path(__file__).resolve().parents[2]
                    / "docs/qa/agentic_exploration/flows/README.md")
    ap.add_argument("--library-empty", action="store_true",
                    help="force adding_book first for every agent that can draw it: "
                         "with no books, most flows have nothing to act on")
    ap.add_argument("--exclude", default="",
                    help="comma-separated flows, top-level or subflow, to drop for "
                         "every agent (e.g. a flow whose content the corpus cannot supply)")
    ap.add_argument("--exclude-for", action="append", default=[], metavar="agent-K=FLOWS",
                    help="comma-separated flows to drop for one agent only (e.g. "
                         "merging_books for an agent owning too few books); repeatable")
    ap.add_argument("--ios", action="store_true",
                    help="add one iOS agent, agent-(N+1), drawn last and only from "
                         "flows whose doc lists iOS")
    args = ap.parse_args()

    if args.agents < 1:
        sys.exit("--agents must be at least 1")
    if args.flows_per_agent < 1:
        sys.exit("--flows-per-agent must be at least 1")

    catalog = parse_catalog(args.catalog)
    excluded = flow_list(args.exclude, catalog, "--exclude")
    # The iOS agent goes last so adding it never shifts the web agents' draws.
    actors = [(f"agent-{i}", "web") for i in range(1, args.agents + 1)]
    if args.ios:
        actors.append((f"agent-{args.agents + 1}", "ios"))
    cuts = agent_exclusions(args, catalog, actors, excluded)

    # A run with no seed is still reproducible, because the seed is emitted.
    seed = args.seed if args.seed is not None else random.SystemRandom().randrange(2**31)
    rng = random.Random(seed)
    agents = []
    for actor, surface in actors:
        drop = set(excluded) | cuts[actor].keys()
        top = [t for t in catalog.top if t not in drop]
        subs = {p: [s for s in names if s not in drop]
                for p, names in catalog.subs.items() if p not in drop}
        # Flows are drawn distinct, so asking for more than exist would silently
        # yield a shorter sequence — a coverage cut that reads as coverage.
        if args.flows_per_agent > len(top):
            sys.exit(f"--flows-per-agent {args.flows_per_agent} exceeds the "
                     f"{len(top)} flow(s) available to {actor} after exclusions")
        first = "adding_book" if args.library_empty and "adding_book" in top else None
        agents.append({
            "actor": actor,
            "surface": surface,
            "excluded": cuts[actor],
            "sequence": draw(top, subs, catalog.after, args.flows_per_agent, rng, first),
        })
    json.dump({"run": args.run, "seed": seed, "excluded": excluded, "agents": agents},
              sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
