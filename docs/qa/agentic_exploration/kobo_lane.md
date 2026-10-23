# The Kobo lane

You are one of possibly several **Kobo agents**. Read [start.md](start.md)
first — everything in it applies. This file says what is different about your
surface: you have a Kobo e-reader of your own, and the device is what you test.

You have three things the runner set up before it briefed you:

- **Your own account**, `explorer-<k>`, the one your actor id names.
- **Your own browser**, driven like a web agent's with `driver.sh`. You use it
  to make shelves, turn their **Sync to Kobo** opt-in on and off, and read the
  results.
- **Your own fake Kobo**: a `mock-kobo` process syncing as your account, with a
  port, a state file and a hardware id nobody else shares. The runner started
  it with `kobo.sh up`. Other Kobo agents have devices of their own, so you
  never meet another agent's library on yours.

## Driving the device

Everything goes through `scripts/explore/kobo.sh`, with **your agent number**
(the `<n>` in `agent-<n>`, the same one you give `driver.sh`):

```bash
scripts/explore/kobo.sh act --agent <n> sync                         # press Sync now
scripts/explore/kobo.sh act --agent <n> show                         # the device: library, last sync
scripts/explore/kobo.sh act --agent <n> download <uuid>…              # download one or more books
scripts/explore/kobo.sh act --agent <n> read <uuid> <percent> [<source> <span>]  # read to a percent
scripts/explore/kobo.sh act --agent <n> read-to <uuid> <passage>      # read to a copied passage
scripts/explore/kobo.sh act --agent <n> finish <uuid>                 # mark a book finished
scripts/explore/kobo.sh act --agent <n> remove-download <uuid>        # clear a book's downloaded flag
scripts/explore/kobo.sh act --agent <n> highlight <uuid> <colour> <passage> [<note>]  # highlight a copied passage
scripts/explore/kobo.sh act --agent <n> delete-highlight <uuid> <id> # delete a highlight
scripts/explore/kobo.sh requests --agent <n>                         # what it asked Omnibus for
scripts/explore/kobo.sh state --agent <n>                            # is it still running?
```

**Never run `up` or `down`, and never use another agent's number.** Starting and
stopping devices is the runner's; a second device for your account, or someone
else's, would corrupt both runs. If `act` answers `no Kobo running for
agent-<n>`, your device died: journal it `uncertain`, say so in the flow's
verdict, and take the next flow. Do not try to start it.

The actions today:

| Action | What it does | What comes back |
|---|---|---|
| `sync` | Presses **Sync now** on your device | `code` `synced` with `details.pages`, or `sync_failed` |
| `show` | Reads the device | `details.library` (every book, keyed by uuid) and `details.last_sync` |
| `download <uuid>…` | Downloads one or more books already on the device | `code` `downloaded`, or `download_failed` with the quirk |
| `read <uuid> <percent> [<source> <span>]` | Sends a reading position; the span is optional | `code` `state_sent`, or `state_failed` with the quirk |
| `read-to <uuid> <passage>` | Reads to the span holding a passage copied from the web reader | `code` `state_sent`, or `passage_not_found`/`not_downloaded`/`book_unreadable`/`no_kobo_spans` (409)/`state_failed` |
| `finish <uuid>` | Marks a book finished and sends it | `code` `state_sent`, or `state_failed` with the quirk |
| `remove-download <uuid>` | Clears a book's downloaded flag, locally | `code` `download_removed` |
| `highlight <uuid> <colour> <passage> [<note>]` | Highlights a passage copied from the web reader (`<colour>` one of `yellow`/`pink`/`blue`/`green`) | `code` `annotation_sent`, or `passage_not_found`/`not_downloaded`/`not_synced`/`book_unreadable`/`no_kobo_spans` (409)/`annotation_failed` |
| `delete-highlight <uuid> <id>` | Deletes a highlight by the id `show` reports in `annotations` | `code` `annotation_sent`, or `not_synced` (409)/`annotation_failed` with the quirk |

The `[<source> <span>]` on `read` is hand-supplied for testing. `read-to` and
`highlight` instead take a **passage** — a run of whole words copied exactly
from the web reader — and find it in the downloaded KEPUB the same way the
reader view resolves a page and a selection; copy enough words to make the
passage unique, since both actions land on its first occurrence in the book.
`no_kobo_spans` means the server sent a plain EPUB (no kepubify).
**A reset is not an agent action yet.** Any action answers `409`
`sync_in_progress` while the device is mid-sync; wait a moment and ask again.

## Reading a reply

`act` prints the control API's JSON as it came, and every reply has the same
envelope:

```json
{"status": 200, "code": "synced", "message": "sync complete", "details": {"pages": 1}}
```

Branch on `code`. The exit status says whether to look: `0` for a 2xx reply,
`1` for any other status or no reply at all, `2` for a command line `kobo.sh`
did not understand.

A failed sync is `502` with `code` `sync_failed`: `message` says what the
device saw, and `details.quirk` names the firmware rule that tripped (for
example `StorePaths` or `SyncPaging`). Quote the quirk in your journal; it tells
a developer which rule broke. A sync already running answers `sync_in_progress`
(409): wait a moment and ask again.

## Journalling

- Device actions are `kobo.<action>` with `--surface kobo`: `kobo.sync`,
  `kobo.show`, `kobo.requests`, `kobo.download`, `kobo.remove_download`.
  Everything you do in the browser keeps `--surface web` and the names its
  flow lists (`shelf.create`, `shelf.edit`).
- **`kobo.sync` has a contract.** The audit reads it, so `target` is null and
  `params` is `{"code": "<reply code>", "books": [<uuids>]}`, or
  `{"code": "<reply code>", "library": <details.library>}` straight from
  `act show`. The recipe that pipes `act show` into the journal is in
  [syncing_a_kobo.md](flows/syncing_a_kobo.md#journalling-the-sync).
- Journal `kobo.show` and `kobo.requests` as looks, with counts rather than the
  whole reply.
- `kobo.download` and `kobo.remove_download` are device-local file state —
  Omnibus keeps no copy the audit can read back — so the vocabulary marks
  them out of scope. Journal them anyway, as looks, so an agent's actions are
  still traceable.
- **A device `read`, `read-to` or `finish` is never journalled as `kobo.*`.**
  `read` is an audit qualifier ("I checked it"), so `kobo.read` would silently
  classify as a look and assert nothing. Journal the position or status change
  itself, with `--surface kobo`: `progress.set --surface kobo` for a `read` or
  a `read-to` (for `read-to`, `params` is `{"percent":
  <details.library[<uuid>].reading.bookmark.percent>}` from the reply's own
  device view, never the passage or a `kobo.*` span), `status.set --surface
  kobo` for a `finish` — see [reading_on_a_kobo.md](flows/reading_on_a_kobo.md).
- **Never journal the device endpoint URL or its token.** The Account page's
  Kobo card shows both, and the journal is kept forever. Nothing here needs
  them: `kobo.sh` already holds the token.
- **A device `highlight` or `delete-highlight` is never journalled as
  `kobo.*`** either, for the same reason as `read`/`finish`: journal
  `highlight.create --surface kobo` and `highlight.delete --surface kobo` —
  see [highlighting_on_a_kobo.md](flows/highlighting_on_a_kobo.md).

## What the audit checks

Your **last `ok` `kobo.sync`** is compared with the books on your
Kobo-synced shelves that Omnibus can deliver (an EPUB, CBZ or PDF; never an
audiobook-only book). The sets must match exactly. A book missing from the
device, or on it with no Kobo-synced shelf to explain it, is a `mismatch`
naming the uuids.

Two things leave the sync unjudged instead, and both are by design:

- **A shelf write after it.** Any `shelf.*` entry you journal after your last
  sync makes that sync a stale picture, so the audit declines it. **End every
  flow on a sync.**
- **A Smart shelf with Sync to Kobo On.** Its members move whenever another
  agent adds or deletes a book, so the audit cannot tell drift from a bad sync.
  Use hand-picked shelves for anything you want judged.

A `kobo.sync` journalled `error` or `uncertain`, or whose `code` is missing or not `synced`,
is never judged.

## Sharp edges

- **No reset** (see above).
- **Audiobook-only books never reach a Kobo.** Their absence is correct.
- **A Smart shelf's membership moves with the library.** Its books on the
  device are right at the moment of a sync and can be wrong a minute later
  through no fault of the sync.
- **The device keeps its library across runs**, because it lives with your
  account. Books an earlier run synced can still be on it, archived once their
  shelf stopped syncing, and a shelf an earlier run left switched on still
  counts. When a checkout's state file does not match the account's "Mock Kobo"
  (a new worktree, a changed `OMNIBUS_EXPLORE_URL`, another checkout that wired
  the account since), `kobo.sh up` revokes it and registers a new one.
- **Newest wins by event time, not arrival time.** The `LastModified` on a
  device write is what the server arbitrates against, and a write older than
  the browser's own last position is *meant* to lose. See
  [reading_on_a_kobo.md](flows/reading_on_a_kobo.md).
