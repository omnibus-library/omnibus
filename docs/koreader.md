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

## Highlights and notes

The plugin keeps an EPUB's highlights and notes in step with Omnibus, so a
passage marked on a KOReader shows in the web reader and on an iPhone at the
same words, and the other way round.

- **When:** the plugin syncs a delivered EPUB's highlights when the book opens
  and closes, and on **Sync now** while it is open. **Sync now** from the file
  manager syncs the library, not highlights: a closed book's highlights wait
  for its next open. A highlight made in Omnibus appears the next time you open
  the book.
- **What follows:** new highlights, note edits, recolours and deletes, both
  ways. A highlight is matched by an id KOReader keeps with it in the book's
  metadata, so the same one is never added twice.
- **Colours:** KOReader has nine, Omnibus five.

  | KOReader → Omnibus | Omnibus → KOReader |
  |---|---|
  | yellow, orange, gray, any other → amber | amber → yellow |
  | red → rose | rose → red |
  | green, olive → green | green → green |
  | cyan, blue → blue | blue → blue |
  | purple → violet | violet → purple |

  A highlight keeps the colour KOReader gave it: an orange one stays orange
  after a note edit on the web, and only a recolour on the web repaints it, in
  the KOReader colour the table gives.
- **Newest wins:** whichever edit happened last on its own device wins, as for
  the reading position, and a device whose clock is ahead is held to the
  server's time. A delete wins over an edit: a highlight deleted on one side is
  deleted on the other even if it was edited meanwhile, and is never brought
  back. Two KOReaders editing one highlight offline can settle on the edit that
  reaches the server first.
- **Exact places only:** a highlight is stored at the passage it covers, using
  the same rules as the reading position. One Omnibus can't place exactly
  (unusual markup, text inside `pre`, SVG) stays on the device, and one KOReader
  can't place stays in Omnibus.
- **Offline:** changes wait on the device and go with the next open, close or
  **Sync now** that finds a connection. A lost or reset book metadata file makes
  the device pull everything again; it never deletes highlights it merely
  stopped seeing.
- **Not synced:** bookmarks (no highlighted text), PDF and CBZ annotations, and
  highlights in sideloaded books.

## Progress sync without the plugin

Stock KOReader's own **Progress sync** can keep your place in step with Omnibus
without installing the plugin. It speaks the same protocol as KOReader's sync
server, which Omnibus serves at `/kosync`.

1. In Omnibus, open **Settings › Devices** and click **Generate password** under
   **KOReader progress sync**. The server URL, your username and the password are
   shown once; copy them now. Generating again replaces the password, and the old
   one stops working.
2. In KOReader, open **Progress sync › Custom sync server** and enter
   `https://<host>/kosync`, with no trailing slash.
3. Choose **Login** and enter your Omnibus username and that password. **Register**
   is refused, because the password is made in Omnibus.

What to expect:

- **Only books downloaded from Omnibus match.** KOReader names a book by a
  fingerprint of the file it holds, and Omnibus knows the fingerprint of every EPUB
  in the library and of every edited copy it has served. A sideloaded book, or one
  with the same name but different bytes, is not recognised: pushing its position
  answers success and stores nothing, and pulling answers that there is none.
  Switching KOReader to *filename* checksums doesn't work either.
- **EPUB positions only.** A PDF or comic isn't matched, and no read status
  travels, only the place.
- **Positions read back as from device "Omnibus".** Omnibus doesn't keep which
  device pushed a position, so KOReader's prompt names "Omnibus" whichever
  device or the web reader last moved. Your own push reads back as already
  synced.
- **A push is dated when it reaches the server.** The protocol carries no time, so
  a push KOReader queued while offline can replace a newer position from the web
  when it finally arrives.
- **The plugin and Progress sync can both run,** but need not: the plugin keeps
  the place on its own at open and close.

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

## Interactive KOReader

`just koreader` opens a real KOReader, in Docker, in a browser tab (a 600x800
screen shown through noVNC), already syncing with this worktree's dev server.
Use it to try a change by hand where the lane only checks scripted scenarios.

```bash
just dev-up                                          # the dev server must be running
just koreader                                        # the default home
just koreader --home .claude/runtime/koreader/second # a second home is a second device
```

It needs Docker running (Docker Desktop on macOS) and a dev server for this
worktree, and never starts either: without them it prints one line saying so and
exits. Ctrl-C, or quitting KOReader, stops the container.

- **First launch of a home** signs in as `OMNIBUS_DEV_SEED_USER`, registers a
  KOReader device (**Dev KOReader**, or **Dev KOReader (<folder>)** for any
  other home) and installs the Omnibus plugin the Settings page would
  download. It also adds the OPDS catalog **Omnibus (dev)** and turns on stock
  Progress sync. Later launches of that home make no requests.
- **Homes** live under `.claude/runtime/koreader/` (`home/` by default), keeping
  KOReader's settings, books and progress between launches. Each home maps to one
  container, so the same home can't open twice.
- **Progress sync** uses one login for every home, because the account has a
  single kosync password: its key is saved in `.claude/runtime/koreader/kosync.json`.
  Delete that file only together with the homes, or the first home's login stops
  working.
- **A sync needs a shelf set to sync** (the shelf's sync toggle), as on a device.
- **Relinking:** a home keeps the dev server port and device token it was linked
  with. After the dev server moves port or its database is reset, delete the home
  and launch it again.

On Linux the container shares the host network, as the lane's does, so it reaches
the dev server on `127.0.0.1`; elsewhere it uses `host.docker.internal`. The
image is the lane's, with a VNC server added; it is built for the engine's
architecture.

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
sentence (the `precise` scenario), and carry a highlight with a note out and a
recolour, a delete and a new highlight back (the `highlights` scenario), and push
a position through stock KOReader's own Progress sync with no Omnibus plugin and pull
the web's back (the `kosync` scenario) —
driven by a real KOReader in Docker, with nothing stubbed. Each scenario prints one PASS/FAIL line.

```bash
just koreader-e2e
# PASS opds
# PASS delivery
# PASS roundtrip
# PASS metadata
# PASS precise
# PASS highlights
# PASS kosync
# or: FAIL opds: search: expected "Alpha" in search results, got ["Beta in the Series"] (screenshot: /tmp/omnibus-koreader.XXXXXX/results/opds.png)
```

The lane boots a scratch server (its own DB, a fresh admin, four
committed fixture EPUBs from `test_data/epubs/generated/`: Alpha and Beta, plus the
two `precise` and `highlights` put on the shelf), builds
[`ui_tests/koreader/`](../ui_tests/koreader/) — a pinned KOReader release
under Xvfb — and runs one container per scenario. The scenario is a KOReader
user patch (`ui_tests/koreader/patches/2-omnibus-e2e.lua`) that drives
KOReader's own OPDS plugin, the Omnibus plugin the runner downloaded
from the real Settings route, or (`kosync`, with no Omnibus plugin mounted) its
built-in Progress sync, and writes a result JSON the report turns into
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
which runs the lane on PRs touching OPDS/auth code, the position, status and
annotation stores, the metadata and export-EPUB code, the kosync routes and file
fingerprints or the lane itself, and nightly.

### Bumping KOReader

The version lives in one line per architecture (amd64 and arm64) of
[`ui_tests/koreader/koreader.sha256`](../ui_tests/koreader/koreader.sha256).
Edit both with each `.deb`'s sha256 and file name from the [KOReader
release](https://github.com/koreader/koreader/releases) — the image derives
the download URL from its architecture's file name and verifies the checksum
before installing, so nothing else pins or fetches KOReader.

### Adding a scenario

A new scenario is an entry in the patch's scenario table
(`ui_tests/koreader/patches/2-omnibus-e2e.lua`) plus an entry in the
runner's `scenarios` list (`scripts/koreader-e2e.sh`). It reports through
the same result JSON contract, so the report and CI need no changes.

### Requirements

The lane is Linux/amd64 with docker only: it uses `--network host` and the amd64
`.deb`. `just koreader` runs on Linux and macOS (Intel or Apple Silicon).
`OMNIBUS_E2E_RELEASE=1` bundles `--release` instead of a debug
build, as it does for `just e2e-ci`.
