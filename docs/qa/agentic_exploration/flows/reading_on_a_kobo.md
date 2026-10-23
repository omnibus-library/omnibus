# Reading on a Kobo

| | |
|---|---|
| **Runs** | on its own |
| **Owner-only** | no — your own shelves and device |
| **Surfaces** | kobo |
| **Actions** | `kobo.sync`, `kobo.show`, `kobo.download`, `progress.set`, `status.set` |

Drawn after [syncing_a_kobo](syncing_a_kobo.md), so you already have a shelf
on your Kobo-synced device. This flow proves the reading-position round trip:
a position the device writes reaches the browser, and a position the browser
writes reaches the device — newest wins by event time either way. Every
device step goes through `scripts/explore/kobo.sh act --agent <n>` — the only
tool that ever touches the device's control API.

## Steps

1. **Sync, then download a book.** `act sync`, then read `details.library`
   from `act show` for a book on one of your Kobo-synced shelves that isn't
   an audiobook-only book. `act download <uuid>` it. The reply's `code` is
   `downloaded`; a `download_failed` naming a quirk is a finding.
2. **Read to 42%:** `act read <uuid> 42`. The reply's `code` is `state_sent`
   and `details.library[<uuid>].reading` shows `"status":"Reading"` and a
   `bookmark.percent` of `42`. Journal this as `progress.set --surface kobo`,
   `params` `{"percent": 42}` and `target` the book's uuid — **never**
   `kobo.read`: `read` is an audit qualifier ("I checked it"), so `kobo.read`
   would silently classify as a look and assert nothing (see
   [kobo_lane.md](../../kobo_lane.md#journalling)).
3. **Check the browser agrees.** Open the book's detail page: it shows about
   42% and status **Reading**. Open the reader; it resumes near 42%, not at
   the start.
4. **Read forward in the browser**, far enough to move the percent, then
   `act sync` and `act show` again. `details.library[<uuid>].reading.bookmark.percent`
   is now ahead of 42 — the browser's newer position reached the device.
5. **Read to a passage in a later chapter:** copy the first words of a
   paragraph past where you are now — enough of them to read uniquely in
   the book — and `act read-to <uuid> "<those words>"`. The reply's `code`
   is `state_sent`; journal it as `progress.set --surface kobo`, `params`
   `{"percent": <the reply's own details.library[<uuid>].reading.bookmark.percent>}`
   and `target` the book's uuid, same as step 2 — never `kobo.read_to`.
   `act sync`, then open the reader in the browser: it resumes on the
   paragraph you named, not wherever step 4 left it.
6. **Finish the book:** `act finish <uuid>`. The reply's `code` is
   `state_sent` and `reading.status` is `"Finished"`. Journal this as
   `status.set --surface kobo`, `params` `{"status": "finished"}` and
   `target` the book's uuid. **End on a sync:** `act sync` once more, so your
   last `kobo.sync` is judged against a device state that includes this run.

## Journalling

- `kobo.sync` and `kobo.show` follow [syncing_a_kobo.md](syncing_a_kobo.md#journalling-the-sync).
- `kobo.download` is device-local file state the audit cannot read back, so
  it is out of scope; journal it anyway, as a look, with the uuid you
  downloaded.
- The position and status changes are `progress.set` / `status.set` with
  `--surface kobo`, exactly as a web agent would journal them — never
  `kobo.read` or `kobo.finish`. See [kobo_lane.md](../../kobo_lane.md#journalling).

## Pass

- `read <uuid> 42` lands as 42% and status Reading, on both the device's own
  reply and the detail page and reader the browser shows.
- A browser position read forward of 42% reaches the device on the next sync.
- `read-to` in step 5 resumes the browser's reader on the paragraph named.
- `finish` lands as status Finished on the device.

## Fail

- The device's `state_sent` reply or the browser disagree about the percent
  or status after step 2.
- The device still shows 42% (or the old status) after a newer browser write
  and a sync in step 4 — the device's older write should have lost.
- The browser's reader opens somewhere other than the paragraph named in
  step 5's `read-to`.
- `finish` leaves the device's status at anything but Finished.

## Sharp edges

- **Never journal `kobo.read` or `kobo.read_to`.** `read` is one of the
  audit's own qualifier words, so an entry named `kobo.read` (or
  `kobo.read_to`) is silently read as a look and never asserts the position
  change you made — journal `progress.set --surface kobo` instead (see
  Journalling above).
- **Newest wins by event time, not arrival time.** The device stamps its own
  write with its own clock; a browser position written after the device's
  but arriving before it (or vice versa) still loses to whichever is
  chronologically newer, not whichever synced first.
- A shelf write, or any action, after your last `kobo.sync` leaves that entry
  unjudged — end on a sync, as step 6 does.
