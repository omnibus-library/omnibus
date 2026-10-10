# After the run — audit, report, verify

Companion to [SKILL.md](SKILL.md) step 9. The runner does these in order once
every agent has reported; neither step is optional, and neither replaces the
other — the audit reads the server back, the report makes the run legible.

Agent prose is unverified; the audit is the only thing that reads the server
back.

```bash
scripts/explore/audit.py --accounts <accounts.json> check --run $RUN
scripts/explore/audit.py vocab --run $RUN     # action names nobody taught it
```

`check` writes `audit.json` next to the journal. Read three things from it:
**`findings`** (`missing`/`mismatch`/`unexpected`/`duplicate`, each carrying
`replay_from` — the `seq` for `audit.py replay --actor <a> --from <seq>`);
**`unverifiable`**, what it declined to judge and why — an *unrecognised
action* there is a verb an agent invented, so add its `(noun, verb)` row to
`audit_lib/vocabulary.py` in the same session; and **`checked`** — many writes
and few checks means the journals are under-filled, not that the app is healthy.

The report is generated, not written by hand — agent prose is unverified, and
the journal plus the server log are the only records that are not.

```bash
python3 scripts/explore/report.py $RUN          # -> <journal dir>/$RUN/*.md
python3 scripts/explore/report.py $RUN --out -  # every file to stdout, under `==> name <==`
```

It reads the run's `journal.jsonl`, the `audit.json` and `groups.json` beside
it, and the instance's JSON log sink over ssh, and writes four files:

| File | Holds |
|---|---|
| `report.md` | the summary: verdict, coverage, one line per defect and execution group, server-log shapes, audit counts, flows that did not pass, **Journal files** |
| `defects.md` | the defect groups, then every defect row and its detail block |
| `execution-defects.md` | the same for execution issues |
| `timeline.md` | server-log findings joined to the causing action, every unchecked write, the merged journal |

Empty sections are omitted — but an input it could not read is always named in
the verdict rather than passing as clean.

### Group the rows — required

Ten agents report one bug many times, so the first render lists every row as
**Ungrouped**. Read `defects.md` and `execution-defects.md`, group the rows that
share a root cause or would share a fix, write `groups.json` beside the journal,
and render again:

```json
{"defects": [{"title": "On your shelves shows others' shelves",
              "root_cause": "manual_shelves_containing filters visible, not owned",
              "checked": true, "lines": [136, 181, 415]}],
 "execution": [{"title": "Runs interrupted by outages", "root_cause": "API limit",
                "checked": false, "lines": [660, 661]}]}
```

`lines` are journal lines — the `L<n>` each row cites — so a group survives a
re-render. Every row belongs to exactly one group of its own kind: `report.py`
exits naming a row left out, listed twice, or not of that kind. Set `checked`
only for a root cause you confirmed in code or on the instance.

The split is the agent's own `kind` on the anomaly — `defect` when the app is
wrong, `issue` when the *run* was. An anomaly with no `kind` is reported as a
defect: misfiling friction costs a row in the wrong table, misfiling a defect
loses it.

Hand back from `report.md`, in its words: the **Defects** and **Execution
issues** group tables, worst first, and **Journal files**. Say a table is empty
rather than dropping it, and point at `defects.md` for the rows.

Instance unreachable? `--no-server-log` skips the fetch, `--server-log <file>`
reads one you have; `--window` widens correlation (default 90s).

Then verify anything high-severity yourself before repeating it to the user —
the difference between a finding and an anecdote has always been the check.

Summarise from `audit.json` and the journal, never from agent prose. The audit
says what the server lost; the anomalies say what looked wrong — you need both:

```bash
scripts/explore/journal.py anomalies --run $RUN
```

Verify anything high-severity yourself before repeating it to the user — the
first run produced one retracted finding and one root-caused CSP bug, and the
difference was checking. State plainly what was excluded, what was left on the
instance, and the snapshot name to roll back to.

## When to recommend a rollback

Restoring is the user's call, never yours; `snapshot.sh restore <name>` is
the command, and you run it only when told to. But the hand-back must say
whether you *recommend* it, and on what evidence. Recommend a restore when the
run left state nobody can explain or nobody can undo through the app:

- a deletion, merge or copy removal on a book or copy the actor did not own —
  one the guard should have refused and did not;
- an audit `unexpected` finding on a **library-wide** thing — a book gone,
  metadata blanked, a cover swapped onto the wrong book — with no journal
  entry to explain it;
- a `high` defect that destroyed data (a merge that lost a side, a shelf
  delete that took a book);
- a baseline book changed in a way no agent journalled.

Do **not** recommend one for per-user leftovers — ratings, shelves, journal
entries, positions on the exploration accounts are what the run is for, and
the next run's baseline absorbs them.

Say the cost too: a restore discards **every** agent's writes from the run,
and any book uploaded during it stays in the journal as owned by an actor
while no longer existing on the instance. That is harmless to ownership (a
future upload of the same file gets a new uuid and a new `book.add`) but the
run's `audit.json` will not reconcile against the restored instance, so mark
the run directory as rolled back — a `ROLLED_BACK` file naming the snapshot
is enough — before anyone reads its report as current.

