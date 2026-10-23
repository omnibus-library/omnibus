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
  book that is already there isn't fetched again unless it changed
  ([Metadata](#metadata)).
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
  the exact spot in an EPUB (below), and the **Reading** and **Finished** statuses. KOReader's *Abandoned* is not
  synced, and *Unread* never reaches the device: a book you haven't started has
  nothing to apply.
- **When:** the plugin pulls when a book opens, so a newer position from the
  web or another device is waiting on the page you land on, with no prompt. It
  pushes when you close the book, when the device suspends, and on **Sync now**.
- **Offline:** a change made without a connection waits on the device and goes
  with the next open, close, suspend or **Sync now** that finds one. A later
  change to the same book replaces the waiting one, so only the latest is sent.
- **Newest wins:** whichever change happened last on its own device wins, not
  whichever reached the server last. Position and status are decided
  separately, and the device sends only what it changed: finishing a book there
  leaves a position saved elsewhere alone, and moving the page leaves the
  status alone.
  A device whose clock is behind loses to a newer change from another device;
  one whose clock is ahead is held to the server's time. Opening a book and
  closing it without reading changes nothing, so a stale device can't overwrite
  a newer position.
- **Precision:** an EPUB's position syncs to the exact spot both ways, so the
  book and the web reader open on the same paragraph and character, and a
  position saved by one replaces the other's. Omnibus keeps the XPointer
  KOReader reports and works out the web reader's position from it; for a
  position saved on the web it works out the XPointer. When it can't place a
  position exactly (unusual markup, text inside `pre`, SVG or image-only pages,
  a book KOReader first opened with an old version) it falls back to the
  whole-book percent, so you land on the page that percent falls on. PDF and
  CBZ are paged and stay percent-only.
- **Finishing on KOReader** is dated by when you finished on the device, not
  when it synced, so the stats count it on that day. A Kobo that already synced
  after that moment gets the change only with its next change to that book.
- **Sideloaded books** (files you copied in yourself, not delivered by the
  plugin) are never read or written.

## Metadata

An edit made in Omnibus reaches the book on the device with the next sync: the
title, authors, series (and its number), description and cover.

- **Shown through KOReader's custom metadata,** the layer **Book information**
  edits, so the file browser, the reader and the cover grid show the edit and
  **Book information › Reset custom** shows the file's own again. An edit made
  on the device to one of those five fields is overwritten when the book next
  changes in Omnibus.
- **A changed EPUB is replaced in place.** When a change alters the file Omnibus
  serves (an edit baked into the EPUB, or a re-scanned file), the plugin
  downloads it over the old one under the same name. The place and highlights,
  kept beside the book, stay. A cover or title edit to a CBZ or PDF is shown
  without downloading the file again.
- **A book that is open** is left alone and updated by the next sync after you
  close it.
- **Names don't change,** except for a format change. A delivered file keeps its
  name after a retitle, and a book that leaves the shelves and returns comes back
  under the name it had, so its kept place and highlights are found again. A book
  that Omnibus now serves in another format (an EPUB that is now a CBZ) is
  delivered under a new name and the old file is removed; its old `.sdr` stays.
- **Hash sidecars:** with KOReader's book-metadata location set to *hash* (or for
  a book that was read under it and not reopened since), the place and highlights
  are tied to the file's contents, so the plugin never replaces that file. The
  metadata and cover still update; the changed file waits and is downloaded by the
  first sync after the book is no longer kept that way. The default location
  (*doc*) isn't affected.

## Test lane

`just koreader-e2e` proves the path a KOReader user takes against Omnibus:
add the OPDS catalog with Basic credentials, browse **All Books**, search,
download the EPUB acquisition, and open it in the reader (the `opds`
scenario), then sync a shelf through the Omnibus plugin and drop it again (the
`delivery` scenario), and open a book at the web reader's position and close it
further on, which the web then shows after a suspend, a close, and a change
made offline that waits for the next Sync now (the `roundtrip` scenario),
and fails if the device token appears in KOReader's log; then retitle and
re-cover a book on the web, which the next sync shows without losing the reader's
place or highlights (the `metadata` scenario), and carry a spot inside a
paragraph both ways, so the device and the web reader open on the same
sentence (the `precise` scenario) — driven by a real KOReader in Docker, with
nothing stubbed. Each scenario prints one PASS/FAIL line.

```bash
just koreader-e2e
# PASS opds
# PASS delivery
# PASS roundtrip
# PASS metadata
# PASS precise
# or: FAIL opds: search: expected "Alpha" in search results, got ["Beta in the Series"] (screenshot: /tmp/omnibus-koreader.XXXXXX/results/opds.png)
```

The lane boots a scratch server (its own DB, a fresh admin, four
committed fixture EPUBs from `test_data/epubs/generated/`: Alpha and Beta, plus the
two `precise` puts on the shelf), builds
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
status stores, the metadata and export-EPUB code or the lane itself, and
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
