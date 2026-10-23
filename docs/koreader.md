# KOReader

Omnibus puts the books on your **Sync to my devices** shelves onto a KOReader
with its own plugin. Nothing runs in the background: you choose **Sync now**
when you want the shelves mirrored.

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

## Test lane

`just koreader-e2e` proves the path a KOReader user takes against Omnibus:
add the OPDS catalog with Basic credentials, browse **All Books**, search,
download the EPUB acquisition, and open it in the reader (the `opds`
scenario), then sync a shelf through the Omnibus plugin and drop it again (the
`delivery` scenario) — driven by a real KOReader in Docker, with nothing
stubbed. Each scenario prints one PASS/FAIL line.

```bash
just koreader-e2e
# PASS opds
# PASS delivery
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
which runs the lane on PRs touching OPDS/auth code or the lane itself, and
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
