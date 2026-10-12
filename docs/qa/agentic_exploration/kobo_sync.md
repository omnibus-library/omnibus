# The Kobo scenario

A runner-driven scenario, like the iOS lane's offline outbox: it is **not** in
the catalog's draw, one web agent is handed it when the run is started with
`--kobo`, and the runner does half the work. A Kobo is a device, and no agent
has one — so the runner plays the device with `mock-kobo`, the repo's fake
e-reader, and with `curl` for the reading-position steps until it models
reading state (#2725), while the agent watches the app.

Two halves, in this order: the **shelf** half proves a shelf marked for Kobo
sync reaches the device; the **sync** half proves a position written by the
device reaches the browser, and a position written in the browser reaches
the device.

## What the runner does before handing this over

Nothing. The agent sets the device up through the app, because that is what a
person does.

## Part 1 — register a device and sync a shelf (agent)

1. Go to your account page and find the **Kobo** section. Click **Add a
   Kobo**, give it a name a person would give a device — *Kitchen Kobo*,
   *Clara's Libra* — and journal the name. **Do not journal the endpoint
   URL.** It carries the device token, which is a credential, and the journal
   is kept forever; hand the URL to the runner out of band instead.
2. Read the setup steps the card shows. They are the instructions a real
   reader follows; if they do not make sense to you, that is a finding about
   the copy.
3. Create a **Smart** shelf with a rule that matches three or four books — an
   author, a genre — and confirm it fills. A hand-picked shelf works too once
   you have added books to it, and a Kobo can only be sent a shelf with books
   on it.
4. Open **Edit shelf** on it and tick the Kobo sync opt-in. Save. Reload and
   confirm the opt-in stuck. A system shelf (the wishlist) must not offer the
   opt-in at all; check that once.
5. Journal `shelf.create` and `shelf.edit` with the name and the opt-in, then
   tell the runner the shelf is ready.

## Part 2 — the device syncs (runner)

With the endpoint URL from the agent, `$KOBO` below, split it and start the
device. Every Bash call is a fresh shell, so pick the scratch dir once and note
what it prints. The temp state file keeps the scenario off this worktree's own
device, and the token goes in the environment, never on the command line:

```bash
ORIGIN="${KOBO%%/kobo/*}"
TOKEN="${KOBO##*/kobo/}"
STATE_DIR=$(mktemp -d); echo "$STATE_DIR"
OMNIBUS_MOCK_KOBO_TOKEN="$TOKEN" scripts/with-dev-env.sh default cargo run -q -p omnibus-mock-kobo -- serve \
  --url "$ORIGIN" --port 0 --state "$STATE_DIR/kobo.json" > "$STATE_DIR/serve.log" 2>&1 &
timeout 600 sh -c 'until grep -q MOCK_KOBO_READY "$1"; do sleep 1; done' _ "$STATE_DIR/serve.log"
PORT=$(sed -n 's/.*MOCK_KOBO_READY port=\([0-9]*\).*/\1/p' "$STATE_DIR/serve.log")
PID=$(sed -n 's/.*MOCK_KOBO_READY .*pid=\([0-9]*\).*/\1/p' "$STATE_DIR/serve.log")
```

If the wait times out, read `$STATE_DIR/serve.log`, journal what it says as a
failure, and stop: the device never started. Otherwise the line it waits for
looks like `MOCK_KOBO_READY port=<n> hardware_id=<id> state=<path> pid=<pid>`.
Later calls set `STATE_DIR` to the printed path again and re-derive `PORT` and
`PID` from `$STATE_DIR/serve.log` with the same `sed` lines.

Press Sync now, then read what the device holds:

```bash
curl -sS -X POST 127.0.0.1:$PORT/actions/sync
curl -sS 127.0.0.1:$PORT/device | python3 -m json.tool | head -80
curl -sS 127.0.0.1:$PORT/requests | python3 -m json.tool
```

Check three things and journal them under the agent's actor with `surface`
`kobo`:

- the sync answers `"code":"synced"`, and `details.library` of `GET /device`
  holds every book on the shelf and **no book off it**;
- each book carries the right `title` and `authors`;
- the sync ends and does not page forever — a sync that never ends answers
  `sync_failed` with quirk `SyncPaging`. `GET /requests` shows what the device
  asked for.

Then, on one of those books (a key of `details.library` is its uuid), write a
position the way the device does:

```bash
curl -sS -X PUT "$KOBO/v1/library/<uuid>/state" \
  -H 'Content-Type: application/json' \
  -d '{"ReadingStates":[{"StatusInfo":{"Status":"Reading"},
       "CurrentBookmark":{"ProgressPercent":42,"LastModified":"<now, RFC 3339>"}}]}'
```

Every sub-result in the response must be `Success`. Journal `progress.set`
under the agent's actor with the uuid, the percent, and `surface` `kobo`,
then hand the agent the uuid and the percent.

## Part 3 — the browser sees the device's position (agent)

1. Open the book's detail page. Its progress should read close to the percent
   the runner wrote, and its read status **Reading**. Reload once if not.
2. Check the continue surface on the home page shows the book.
3. Open the reader. It should open near that percent — within a page, since a
   percent is a page-grained position. Journal where it opened.
4. Read forward a chapter or so, then leave. Journal the position you left at
   and tell the runner.

## Part 4 — the device sees the browser's position (runner)

```bash
curl -sS "$KOBO/v1/library/<uuid>/state" | python3 -m json.tool
```

The `CurrentBookmark` must now carry a percent **ahead** of the one written in
Part 2. It carries **no `Location`**: the server stores a Kobo location
verbatim when a *device* sends one and derives a CFI from it, and nothing
synthesises a location in the other direction, so a browser position reaches
the device as a whole-book percent alone. Do not file its absence. Journal what
came back. Then sync once more with `POST /actions/sync`: it answers
`synced`. Whether the re-sync sends the book as a `ChangedReadingState` and
**not as a new entitlement** is checked with #2725, with the rest of the
device's reading state: the mock's library cannot show which kind arrived.

Finally, ask the agent to untick the Kobo opt-in on the shelf and sync once
more with `POST /actions/sync`: `GET /device` shows each book with
`"archived": true`.

## Journal

Agent: `shelf.create`, `shelf.edit`, `book.open`, `reader.progress` as their
flows prescribe. Runner: `progress.set` for the device's write and
`sync.check` for each sync, both under the agent's actor with `surface`
`kobo`. The audit checks the `progress.set` as a saved reading position and
reads `sync.check` as a look, so it neither checks nor flags it; the runner's
journal entries are the record. `shelf.edit` is checked as the shelf still
existing under the name it carries; the opt-in itself is not audited.

## Pass

- The shelf's books, and only those, reach the device.
- The device's position and status appear in the browser.
- The browser's position reaches the device, ahead of the device's own.
- Removing the opt-in removes the books from the device on the next sync.
- The wishlist never offers the opt-in.

## Fail

- A book not on the shelf is sent to the device, or a book on it is missing.
- The device's write is accepted but the browser shows the old position.
- The browser's later position never reaches the device, or reaches it
  behind the device's own.
- A sync that never terminates.
- The device's stale position overwrites a newer browser position. High
  severity.

## Sharp edges

- **Newest wins by event time, not arrival time.** The `LastModified` on the
  device's write is what the server arbitrates against. A device write with a
  timestamp older than the browser's last position is *meant* to lose.
- A percent from a device is whole-book and page-grained. The reader opening
  at the top of the right page is agreement.
- The shelf half sends only opted-in shelves. A book in the library but on no
  synced shelf is correctly absent from the device.
- Stop the mock-kobo process (`kill $PID`, the `pid` on its READY line) after
  the final sync of Part 4 and before removing the device: it holds the
  device's token, and a device that outlives its removal only logs failed
  syncs.
- The device token is per device and persists. Remove the device from the
  account page at the end of the scenario, and journal that you did —
  **after** the final sync of Part 4, never before. The token is the only way
  into the device endpoint, so removing it first makes the last Pass criterion
  permanently unobservable. Journal the registration as `device.add` and the
  removal as `device.remove`; neither is audited.
- The **Kobo opt-in is not on the create form**, only on Edit shelf — so a
  shelf made for a Kobo has to be created and then immediately reopened. The
  opt-in is also offered on a hand-picked shelf, which may still be empty, so a
  reader can opt in a shelf that holds nothing yet.
- The wishlist offers no opt-in because it has **no edit affordance at all**,
  which is a stronger thing than the form omitting the toggle. Check an empty
  hand-picked shelf of your own to be sure you are seeing system-ness rather
  than emptiness.
