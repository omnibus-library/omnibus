# Runner-driven scenarios and the draw's exclusions

Companion to [SKILL.md](SKILL.md) steps 4, 5 and 8. What the sampler and the
scripts need you to decide or do, and how to do it without turning a guess
into coverage.

## Exclusions to pass to `sample.py`

The sampler takes every exclusion as a flag and emits it with the draw — the
run-wide ones in the top-level `excluded`, each agent's own in its `excluded`
with the reason. **Never edit the emitted draw by hand**, and say every
exclusion in the hand-back — a silent one reads as a flow that ran.

- **`merging_books` needs two owned books.** It always runs inside
  `adding_book`, which uploads one — so the agent needs at least one more
  from an earlier run. Before the run, count each agent's owned uuids:
  `scripts/explore/owned.sh agent-N | tr ',' '\n' | wc -l`. For an agent with
  none, pass `--exclude-for agent-N=merging_books`.
- **The iOS agent needs nothing extra.** `--ios` draws it only from flows
  whose doc lists iOS, so `adding_book`, `merging_books` and
  `deleting_a_book` — web-only, with no ownership guard on that surface —
  never reach it; its `excluded` lists them as `surface ios`.
- **A comic reader needs a CBZ, and a listening flow needs audio.** The
  library listing's formats column says which exist. If none does, `--exclude
  listening_to_audiobook` at draw time; for comics, tell the agent handed
  `reading_a_book` that no CBZ exists so it does not hunt for one.
- **`viewing_stats` is ordered by the catalog.** Its **Drawn after** cell
  moves it behind any reading or listening flow drawn before it.

## The corpus files already used

`adding_book.md` promises the agent a list of corpus files already uploaded.
Uploads in earlier runs count, and an upload that never produced a book does
not retire its file:

```bash
scripts/explore/owned.sh --files all
```

Hand each agent that list with the corpus path. Two agents drawing
`adding_book` in one run must be handed **different** files by you, or both
may pick the same one and the second silently attaches to the first.

## One fresh subagent per flow

A subagent cannot be messaged after it reports, so every flow is a fresh
subagent. Keep the standing part of the brief — identity, driver, journal,
rails, corpus — in one file per agent and point each new subagent at it, and
give it a two-sentence recap of what its actor did in earlier flows (the
books it touched, the names it used, where the browser is). Each brief hands
the agent the `scratch` directory `driver.sh up` printed for it: the harness's
scratchpad is shared, and one run routed an agent's commands into another
agent's browser through a clobbered helper script.

Two things look like a finished agent and are not. A subagent that backgrounds
a long sleep fires a completion notification while its flow is still open —
**read the journal for a `flow.end` before handing the next flow**; the
duplicate iOS agent of run `r-20260908-01` came from trusting the
notification. And an API rate limit kills every subagent at once, mid-flow:
on resume, `scripts/explore/journal.py open-flows --run $RUN` lists each
actor's open flows and the entry it stopped on; brief the fresh subagent to
finish them without writing a second `flow.start`.

## Non-admin readers

Every provisioned account is an admin unless `--reader <k>` makes one web
agent's account a reader — `k` in `1..N`, never `N+1`, the iOS agent's under `--ios`:

```bash
scripts/explore/provision.sh <N> --reader <k>   # <N+1> with --ios; explorer-k: no admin, no upload
```

Tell `agent-k` in its brief that it is a **reader**: it will see no **Delete
files…**, no other user's private shelves, and "You
don't have permission to add books" on the add page — the criteria the
catalog marks undecidable for admins become decidable for it. Every call sets
each account's permissions to its role, so last run's reader is this run's
admin again without anyone touching **Settings → Users**.

## The phantom device (`resuming_from_another_device`)

Before handing that subflow over, write a position to the agent's own account
as a second device would. `$ACCT` is the agent's `username:password` from
`provision.sh`, `$JAR` a fresh cookie jar:

```bash
source scripts/explore/lib.sh && explore::load_env
explore::curl -c "$JAR" -X POST "$EXPLORE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ACCT%%:*}\",\"password\":\"${ACCT#*:}\"}" -o /dev/null
explore::curl -b "$JAR" -X POST "$EXPLORE_URL/api/progress" \
  -H 'Content-Type: application/json' \
  -d '{"book_uuid":"<uuid>","format":"epub","progress_percent":40,
       "client_updated_at":<unix seconds>}'
```

- **`newer`**: a percent ahead of anything the agent has reached, and
  `client_updated_at` = now. Optionally also `PUT /api/read-status` with
  `{"book_uuid":…,"status":"reading"}`, and say that you did.
- **`stale`**: only on a book the agent has already read in an earlier flow.
  A percent behind its last position, and `client_updated_at` a few minutes
  *before* that position's timestamp — the server keeps the newest event.

Journal it under the agent's actor with `journal.py append --actor agent-N
--surface phantom --flow resuming_from_another_device --action progress.set
--target <uuid> --params '{"format":"epub","percent":40,"variant":"newer"}'`.
Then hand the agent the flow with the uuid, the variant, and the position in
human terms. Pick a book no other agent is reading or editing, and one the
agent has not opened — the audit keys progress per book, and a percent
placed ahead of a later sitting makes that sitting credit zero pages on the
Stats page, which is honest but confusing to the agent handed `viewing_stats`
afterwards.

## The Kobo scenario (`--kobo`)

[`kobo_sync.md`](../../../docs/qa/agentic_exploration/kobo_sync.md) is
handed to **one web agent** on top of its draw, and its Parts 2 and 4 are
yours. The agent gives you the device endpoint out of band — never through the
journal — and you drive the device with the `curl` calls in that file,
journalling each under the agent's actor with `surface: kobo`. Remove the
device from the agent's account page at the end, or it persists.
