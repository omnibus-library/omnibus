# Syncing a Kobo

| | |
|---|---|
| **Runs** | on its own |
| **Owner-only** | no — your own shelves and device |
| **Surfaces** | kobo |
| **Actions** | `kobo.sync`, `kobo.show`, `kobo.requests`, `shelf.create`, `shelf.edit` |

You have a Kobo of your own: a fake one the runner started for you, syncing as
your account (see [kobo_lane.md](../kobo_lane.md)). A shelf marked **Sync to
Kobo** is sent to it when it syncs. This flow proves the right books arrive:
the ones on your Kobo-synced shelves, with the right titles and authors, and no
others.

You work both sides. The **browser** makes the shelf and turns its opt-in on;
**`kobo.sh`** is the device. Every device step is
`scripts/explore/kobo.sh act --agent <n> …`, with `<n>` your agent number.

## Steps

1. **Make a hand-picked shelf of three or four books** —
   [creating_a_shelf.md](creating_a_shelf.md) says how to fill one. Use a
   hand-picked shelf, not a Smart one: a Smart shelf's members move whenever
   another agent adds or deletes a book, so the audit cannot tell a drifting
   shelf from a bad sync and leaves it unjudged. If the library has an
   **audiobook-only** book, add it too; it must not reach the device. Journal
   `shelf.create`.
2. **Turn on Sync to Kobo.** The opt-in is not on the create form: open
   **Edit shelf**, switch **Sync to Kobo** to **On**, save, then reload and
   confirm it stuck. Journal `shelf.edit` with the shelf's `name` and
   `sync_to_kobo` as `{"old": false, "new": true}`.
3. **Sync the device:** `act sync`. It answers `"code":"synced"`. A
   `sync_failed` is a finding; its `details.quirk` names the firmware rule that
   tripped. Journal it as an anomaly with the reply.
4. **Read what the device holds:** `act show`. In `details.library` (keyed by
   book uuid), check that:
   - every book on your Kobo-synced shelves is there, and no book off them
     (a shelf an earlier run left switched on counts as yours, and an entry
     marked `"archived": true` is a book the device no longer shows);
   - each book carries the right `title` and `authors`; compare with the
     book's own page;
   - the audiobook-only book, if you added one, is absent. That is correct,
     not a miss.
5. **Journal the sync** with the recipe below. The audit checks this entry
   against your Kobo-synced shelves.
6. **See that the sync ended:** `act requests` lists what the device asked
   Omnibus for. It is a short, finite list. A sync that never ends answers
   `sync_failed` with quirk `SyncPaging` instead.
7. **Sync again with nothing changed:** `act sync`, then `act show`. The
   library is as it was: the same books, none duplicated, none newly archived.
   Journal it as another `kobo.sync`; the later entry is the one the audit
   judges.
8. **Open your account page.** Its **Kobo** card lists your device, **Mock
   Kobo**, once. The card shows no sync time, so what synced is proved by the
   steps above, not by the card. Leave **Regenerate** and **Remove** alone:
   either one cuts your device off.

## Journalling the sync

`kobo.sync` records what the device held **after** the sync, so pipe `act show`
into the journal instead of retyping uuids:

```bash
scripts/explore/kobo.sh act --agent <n> show \
  | python3 -c 'import json,sys
print(json.dumps({"code": "synced", "library": json.load(sys.stdin)["details"]["library"]}))' \
  | scripts/explore/journal.py append --run <run> --actor agent-<n> \
      --flow syncing_a_kobo --surface kobo --action kobo.sync --params -
```

`<run>` is the run id you were handed. `code` is the `code` of the `act sync`
reply you are recording; if that sync failed, add `--outcome error --note …`.
The audit reads the books out of `library`, leaving out entries marked
`"archived": true`. Journal `kobo.show` and `kobo.requests` as looks, with the
counts you saw. Never journal the device endpoint URL or token the account
page shows.

## Pass

- The books on your Kobo-synced shelves, and only those, reach the device, with
  the right titles and authors.
- An audiobook-only book never arrives.
- A second sync with nothing changed leaves the library as it was.
- The sync ends.

## Fail

- A book not on any Kobo-synced shelf is on the device, or one that is on a
  shelf is missing.
- A title or author is wrong.
- A second sync duplicates, archives or drops a book.
- A sync that never terminates, or a `sync_failed` on a healthy shelf.

## Sharp edges

- **Not covered here: the reading-position round trip** — a position the
  device writes and the browser shows, and the reverse. It waits until the
  device can write reading state (#2725); do not fake it with `curl`.
- Only opted-in shelves sync. A book in the library on no synced shelf is
  correctly absent from the device.
- The device keeps its library across runs, because its account does. Books an
  earlier run synced may still be there, archived once their shelf stopped
  syncing.
- A shelf write after your last `kobo.sync` leaves that entry unjudged, so the
  last thing you do is sync.
- The **Kobo opt-in is not on the create form**, only on Edit shelf, so a shelf
  made for a Kobo is created and then reopened.
- `act` has no reset: after one, Omnibus would still count what it sent
  (#2743) and the next sync would leave books missing.
