# KOReader

Omnibus puts the books on your **Sync to my devices** shelves onto a KOReader
with its own plugin, and keeps your place in them in step. Nothing runs in the
background: you choose **Sync now** when you want the shelves mirrored, and
your place travels when you open and close a book.

## Setup

1. In Omnibus, open **Settings › Devices**, name the device and click **Add a
   KOReader**.
2. Click **Download plugin** on its row. The zip is already set to this server
   and to that KOReader's token. The token is a password: anyone holding the zip
   can sync as you, so don't share it.
3. Unzip it so the `omnibus.koplugin` folder sits in KOReader's `plugins`
   folder:
   - Kobo: `.adds/koreader/plugins`
   - Kindle: `koreader/plugins`
   - PocketBook: `applications/koreader/plugins`
   - Android: `koreader/plugins` on the device's storage
4. Restart KOReader.
5. Open **Tools › Omnibus › Sync now** (the wrench tab, in the file browser and
   in the reader).

Mark the shelves to sync with **Sync to my devices** first; see [Kobo](kobo.md)
for the same shelf rule, which both device kinds share.

### What a sync does

- Books on your marked shelves are downloaded into an `Omnibus` folder inside
  KOReader's home folder, as plain EPUB (or the CBZ/PDF a book only has). A
  book that is already there isn't fetched again.
- A book that leaves every marked shelf is deleted from that folder. Its
  reading progress and highlights (the `.sdr` folder beside it) are kept, so
  the book picks up where you left off if it returns.
- The plugin only deletes files it delivered itself. Anything else in the
  `Omnibus` folder, or anywhere else on the device, is never touched.
- The device shows the outcome. A failure is also sent to the server, so
  **Settings › Devices** shows the date of the last sync and the last error.
  If the device can't reach the server, only the device says so.
- Removing the KOReader in Settings revokes its token. The next sync on the
  device says it was removed; download the plugin again from a new KOReader.
- Your account needs the download permission; without it every download is
  refused and the sync reports it.

Sync blocks KOReader's screen while it runs, so a large first sync takes a
while.

## Reading position

The plugin keeps each delivered book's place and status in step with Omnibus,
so you can read on a KOReader and pick up in the web reader or on an iPhone,
and the other way round.

- **What syncs:** how far through the whole book you are, as a whole percent,
  and the **Reading** and **Finished** statuses. KOReader's *Abandoned* is not
  synced, and *Unread* never reaches the device: a book you haven't started has
  nothing to apply.
- **When:** the plugin pulls when a book opens, so a newer position from the
  web or another device is waiting on the page you land on, with no prompt. It
  pushes when you close the book, when the device suspends, and on **Sync now**.
- **Offline:** a change made without a connection waits on the device and goes
  with the next open, close, suspend or **Sync now** that finds one. A later
  change to the same book replaces the waiting one, so only the latest is sent.
- **Newest wins:** whichever change happened last on its own device wins, not
  whichever reached the server last. Position and status are decided separately.
  A device whose clock is behind loses to a newer change from another device;
  one whose clock is ahead is held to the server's time. Opening a book and
  closing it without reading changes nothing, so a stale device can't overwrite
  a newer position.
- **Precision:** KOReader sends a whole percent, so a finer position saved by
  the web reader is replaced by it, and Omnibus opens the book at the page that
  percent falls on.
- **Finishing on KOReader** is dated by when you finished on the device, not
  when it synced, so the stats count it on that day. A Kobo that already synced
  after that moment gets the change only with its next change to that book.
- **Sideloaded books** (files you copied in yourself, not delivered by the
  plugin) are never read or written.

## Test lane

`just koreader-e2e` proves the path a KOReader user takes against Omnibus:
add the OPDS catalog with Basic credentials, browse **All Books**, search,
download the EPUB acquisition, and open it in the reader (the `opds`
scenario), then sync a shelf through the Omnibus plugin and drop it again (the
`delivery` scenario), and open a book at the web reader's position and close it
further on, which the web then shows (the `roundtrip` scenario) — driven by a
real KOReader in Docker, with nothing stubbed. Each scenario prints one PASS/FAIL line.

```bash
just koreader-e2e
# PASS opds
# PASS delivery
# PASS roundtrip
# or: FAIL opds: search: expected "Alpha" in search results, got ["Beta in the Series"] (screenshot: /tmp/omnibus-koreader.XXXXXX/results/opds.png)
```

The lane boots a scratch server (its own DB, a fresh admin, the two
committed fixture EPUBs from `test_data/epubs/generated/`), builds
[`ui_tests/koreader/`](../ui_tests/koreader/) — a pinned KOReader release
under Xvfb — and runs one container per scenario. The scenario is a KOReader
user patch (`ui_tests/koreader/patches/2-omnibus-e2e.lua`) that drives
KOReader's own OPDS plugin, or the Omnibus plugin the runner downloaded
from the real Settings route, and writes a result JSON the report turns into
the verdict line. Exits non-zero on any failure. The plugin's sync logic is
also unit-tested without KOReader by `just koreader-plugin-test`.

### Reading a failure

A failure keeps the scratch dir and names it (`kept /tmp/omnibus-koreader.XXX`):

- `results/<scenario>.json` — the step list, with the first failing step's detail
- `results/<scenario>.png` — the screen at the failure
- `results/<scenario>.koreader.log` — KOReader's console output
- `server.log` — the scratch Omnibus server

In CI the same directory is uploaded as the `koreader-lane` artifact
(retention 7 days) by [`.github/workflows/koreader.yml`](../.github/workflows/koreader.yml),
which runs the lane on PRs touching OPDS/auth code, the position and
status stores or the lane itself, and
nightly.

### Bumping KOReader

The version lives in one line:
[`ui_tests/koreader/koreader.sha256`](../ui_tests/koreader/koreader.sha256).
Edit it with the `.deb`'s sha256 and file name from the [KOReader
release](https://github.com/koreader/koreader/releases) — the image derives
the download URL from the file name and verifies the checksum before
installing, so nothing else pins or fetches KOReader.

### Adding a scenario

A new scenario is an entry in the patch's scenario table
(`ui_tests/koreader/patches/2-omnibus-e2e.lua`) plus an entry in the
runner's `scenarios` list (`scripts/koreader-e2e.sh`). It reports through
the same result JSON contract, so the report and CI need no changes.

### Requirements

Linux/amd64 with docker only: the lane uses `--network host` and the amd64
`.deb`. `OMNIBUS_E2E_RELEASE=1` bundles `--release` instead of a debug
build, as it does for `just e2e-ci`.
