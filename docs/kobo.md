# Kobo

Omnibus gets books onto a Kobo e-reader two ways, and you can use either or
both:

- **[Send to Kobo](#send-a-book-over-usb)** — a one-off copy over a USB cable.
  Nothing syncs back; it's a file transfer.
- **[Wireless sync](#wireless-sync)** — the device talks to Omnibus over Wi-Fi
  on its own. Whole shelves, plus reading position, read status, and highlights
  in both directions.

Either way the book is converted to a **KEPUB** — Kobo's own EPUB variant, which
gets noticeably faster page turns than a plain EPUB.

No device to hand? Developers can [test wireless sync with a mock
Kobo](#testing-without-a-device) instead.

## Send a book over USB

Your Kobo plugs into the computer running the browser (never the Omnibus
server), and the book copies onto it over USB.

On **Chrome or Edge**, Omnibus writes the file straight onto the plugged-in
device in one click. On other browsers (Firefox, Safari), it downloads the KEPUB
and you copy it over yourself. Both are described below.

> [!TIP]
> This transfer is completely safe for your device. Copying a file over USB
> **cannot delete or change anything already on your Kobo** — not your books,
> not your highlights, not your notes. Omnibus only ever *adds* a book file; it
> never touches the device's internal database. (That is *not* true of
> [wireless sync](#wireless-sync), which does write to it.)

### Chrome / Edge — one-click write

1. Connect your Kobo with a USB cable and tap **Connect** on the device. It
   appears as a USB drive.
2. Open the book's page in Omnibus and click **Send to Kobo**.
3. The first time, your browser asks you to pick a folder — choose the **Kobo
   drive** and allow saving. Omnibus remembers it, so later sends write silently
   with no prompt.
4. When it reports success, **eject the Kobo safely**, then unplug it. The book
   appears in your library, titled from its own metadata (not the filename).

On this one-click write path, Omnibus files each book under `<Author>/<Title>/`
on the drive (the same tidy layout Calibre uses), so browsing the device over
USB stays organized rather than a pile of files at the root. (The download-then-
copy path below hands you a single file instead — drop it wherever you like.)

### Other browsers — download, then copy

1. Open the book's page in Omnibus and click **Send to Kobo**. A file named
   `<id>.kepub.epub` downloads to your computer.
2. Connect your Kobo with a USB cable and tap **Connect** on the device. It
   appears as a USB drive.
3. Copy the downloaded `.kepub.epub` file onto the Kobo drive. You can drop it at
   the top level or into any folder — the Kobo scans the whole drive.
4. **Eject the Kobo safely**, then unplug it. The book appears in your library.

Either way, open the book on the Kobo and you'll get the faster KEPUB page turns.

### What this does and doesn't do

- **Does:** put a reading-optimized copy of the book on your device.
- **Doesn't:** sync your reading position, mark the book finished, or send
  anything back to Omnibus. It's a one-way file copy.
- **Doesn't touch existing device content.** Nothing on the Kobo is modified or
  deleted by copying a file to it.

### If the download is a plain `.epub`

Omnibus converts to KEPUB with a tool called
[`kepubify`](https://github.com/pgaskin/kepubify). If that tool isn't installed
on the server, Omnibus falls back to serving the **plain EPUB** (filename ends in
`.epub` instead of `.kepub.epub`). A Kobo reads plain EPUB fine — page turns are
just a bit slower. The official Docker image ships `kepubify`; if you build from
source, install `kepubify` on the server's `PATH` (or set `OMNIBUS_KEPUBIFY_PATH`)
to get KEPUB output. See [.env.example](../.env.example).

## Wireless sync

The device talks to Omnibus over Wi-Fi instead of a USB cable, the way it would
talk to the Kobo store. Shelves you opt in appear in the device's own library;
reading position, read status, and highlights flow both directions on every
sync.

Books with an EPUB sync as KEPUB. A comic-only book (CBZ) and a PDF-only book
sync as the file itself, which the device reads natively. For those two the
reading position round-trips as a percent only, and highlights do not sync:
Kobo firmware cannot annotate a CBZ or a PDF, and a PDF highlight made on the
web or in the iOS app has no KEPUB position to translate to.

You need:

- **An Omnibus server the Kobo can reach on its own Wi-Fi** — a LAN address or
  a tunnel, not `localhost`. The device does the talking, so whatever URL you
  give it has to resolve from the device.
- **At least one shelf marked "Sync to Kobo"** — only opted-in shelves sync, so
  set this before the first sync or the device pulls an empty library.
- **A USB cable, once**, to edit a config file on the device.

> [!WARNING]
> **First sync can erase your Kobo's highlights**
>
> An improper sync can potentially wipe data on the Kobo like your annotations,
> notes, bookmarks, reading progress, and books.
>
> It is highly recommended to back up your device before attempting a sync with
> one of these tools:
>
> - [omnibus-library/kobo-backup](https://github.com/omnibus-library/kobo-backup#kobo-backup)
> - [karlicoss/kobuddy](https://github.com/karlicoss/kobuddy#usage)
>
> At minimum, copy `.kobo/KoboReader.sqlite` off the device over USB.

### Setting it up

Back up the device first — see the warning above.

1. In a shelf's settings, turn on **Sync to Kobo** for whatever you want the
   device to carry.
2. Go to **Account → Kobo wireless sync**, give your Kobo a name, and click
   **Add a Kobo**. Omnibus prints that device's own sync endpoint —
   `<your_omnibus_server_url>/kobo/<token>`. The token identifies the device,
   so treat the URL as a secret and use a different one per Kobo. If the
   server is on a port other than 80 or 443, such as
   `http://192.168.1.10:3001`, also list that address in
   `OMNIBUS_PUBLIC_ORIGIN`. The Kobo leaves the port off its requests, and
   without that entry its download links point at the wrong port.
3. Connect the Kobo over USB and tap **Connect** on the device. It appears as a
   USB drive.
4. Open `.kobo/Kobo/Kobo eReader.conf` on that drive and set `api_endpoint=`
   under the `[OneStoreServices]` heading to the URL from step 2, replacing the
   Kobo store URL already there. Save the file.

   ```ini
   [OneStoreServices]
   api_endpoint=https://omnibus.example.com/kobo/<token>
   ```

5. Eject the Kobo safely and unplug it. On the device, **Reading → Sync now** —
   your opted-in books appear in its library.

(`.kobo` is a hidden folder — on macOS press
<kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd> in Finder to reveal it; on Windows enable
**Hidden items** in Explorer's View tab.)

To stop syncing, point `api_endpoint` back at the Kobo store URL you replaced,
or remove the device from **Account → Kobo wireless sync**.

### Highlights and notes

Highlights sync both ways. Highlights made **on the device** flow up to
Omnibus automatically and appear in the web reader. Highlights created **in
the web reader** are converted into device-placeable anchors and delivered to
the Kobo on its next sync — recolors, note edits, and deletes follow.

A web highlight is anchored against the book's converted KEPUB copy, so that
copy has to exist before the highlight can be placed. It is built on demand
and cached; when it is missing, Omnibus queues the conversion itself and
materializes the pending highlights as soon as it lands. Nothing is lost in
the meantime — the highlight stays web-only until the anchor can be derived.

Two things can stop that: `kepubify` not being installed (see [If the
download is a plain `.epub`](#if-the-download-is-a-plain-epub)), and the
book's source file being unreachable when the conversion runs — a library on
a network share that isn't mounted, for example. Both retry on the next
highlight you make on that book, and on every server restart.

Even with the KEPUB in hand, a highlight only converts when it and the source
EPUB still carry the same text — a conversion that can't be proven correct is
skipped (the highlight simply stays web-only) rather than placed somewhere
wrong.

> [!NOTE]
> **Annotations only materialise on a book the device actually holds**
>
> Highlights for a book are only useful once the device has that book's file —
> so Omnibus only lets a wireless GET for a book's annotations count as
> delivered once the device has downloaded it (over this same wireless
> channel). Downloading a book always triggers an unconditional fetch of its
> annotations, independent of the periodic sync check — so opening (or
> re-opening) **Reading → Sync now** on the device after downloading a book is
> the reliable way to pull down highlights that were waiting for it.

> [!NOTE]
> **Highlight colour on-wire shape: changed to a firmware hex swatch, still
> unconfirmed against a real device**
>
> Omnibus used to send each annotation's colour as `highlightColor` — a
> lowercase CSS-style colour name (`yellow`/`green`/`blue`/`pink`/`purple`)
> — in the Reading Services annotation payload. On at least one real device,
> every annotation pushed from Omnibus was observed stored on-device with
> `Bookmark.Color = 0` (yellow) regardless of the colour sent, while
> highlights created directly on the device use the full `Color` range
> normally (the original report, with the device's `KoboReader.sqlite` data:
> [#1629](https://github.com/omnibus-library/omnibus/issues/1629)).
>
> This repo still carries no captured device PATCH for the Reading Services
> protocol, but a follow-up investigation turned up a genuine shape
> difference: the firmware's own highlight menu offers exactly **four fixed
> swatches**, and the wire value for one appears to be its hex colour rather
> than a CSS-style name:
>
> | Named colour | Hex swatch |
> |---|---|
> | yellow | `#F6F3B3` |
> | green | `#C6E09E` |
> | blue | `#B2E1E8` |
> | pink | `#E8AFCF` |
>
> A CSS-style name being silently ignored in favour of the palette default
> would exactly reproduce the observed symptom — every pushed annotation
> landing at index 0 (yellow) — so Omnibus's outbound `highlightColor` now
> sends these hex values (`color_to_kobo` /
> `color_from_kobo` in
> [reading_services/dto.rs](../server/src/backend/kobo/reading_services/dto.rs)).
> The inbound parser accepts **both** the hex swatches and the old CSS names,
> so an already-adopted device or an unverified firmware revision that still
> sends a name keeps working.
>
> **This is still unverified against real hardware** — nothing available
> here pins this exact field to a device capture, so the fix is inferred
> from the observed symptom, not proven. If highlights pushed from Omnibus
> still land
> as yellow after this change, the firmware likely ignores `highlightColor`
> on inbound annotations entirely rather than wanting a different shape, and
> that would be the next thing to rule out. Kobo's classic highlight menu
> has no fifth swatch for Omnibus's violet, so on-device it renders
> identically to rose (pink) — a real palette limit, not a bug. Highlight
> and note **text**, placement, and deletes were never affected — only
> colour. Confirming (or refuting) this needs a `.kobo/KoboReader.sqlite`
> capture (or a packet capture) from a device that just received a coloured
> highlight over wireless sync, per AC2 of #1629.

## Testing without a device

For development: `mock-kobo` is a fake Kobo e-reader that syncs against the
same `/kobo/<token>/v1/*` routes a real device uses, so wireless sync can be
tried, and its bugs reproduced, with no hardware. Like a real Kobo, it leaves
the port off `Host`, so a server on a port other than 80 or 443 must list its
address in `OMNIBUS_PUBLIC_ORIGIN`.

### In a terminal

Start the dev server (`just dev-up`), then run:

```bash
just kobo
```

It follows this worktree's dev server, logs in as `OMNIBUS_DEV_SEED_USER`, and
reuses or creates the Omnibus device named "Mock Kobo". The screen shows the
device's hardware id, URL, library, last sync and the requests it made.

The seeded admin starts with a **Kobo library** smart shelf that holds every
EPUB, CBZ and PDF and has **Sync to Kobo** on, so the first sync downloads all
of them. The server adds that shelf only when it creates the admin. If your dev
database already had an admin, mark a shelf **Sync to Kobo** yourself.

| Key | Does |
|---|---|
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move the selection (marked `>`) within the library |
| <kbd>Enter</kbd> | Open the selected book: a downloaded KEPUB in the reader, else a metadata-only view |
| <kbd>d</kbd> | Download the selected book |
| <kbd>p</kbd> | Edit the selected book's read percent (0–100), sent as a `Reading` state on <kbd>Enter</kbd> |
| <kbd>f</kbd> | Mark the selected book finished |
| <kbd>x</kbd> | Clear the selected book's downloaded flag, locally |
| <kbd>s</kbd> | Sync now |
| <kbd>r</kbd> | Reset the device: empty library, no sync token, so the next sync resends every opted-in book |
| <kbd>u</kbd> | Edit the server URL (pinned and saved) |
| <kbd>t</kbd> | Edit the device token (saved) |
| <kbd>w</kbd> | Wire a token for the current URL, as startup does |
| <kbd>q</kbd> / <kbd>Ctrl-C</kbd> | Quit |

Each book line shows `downloaded`, `download failed`, the bookmark percent,
`finished`, its highlight count, and a dropped-highlight count, whichever
apply. Opening a downloaded book shows its text in the reader: closing it
(Esc, or quitting with Ctrl-C) sends the open page's `KoboSpan` position,
and a word selection becomes a highlight (see "In the reader" below). A page
that opens mid-sentence bookmarks that sentence's own span, so reopening the
book shows the page where the sentence starts, not the one it was left on.

### In the reader

| Key | Does |
|---|---|
| <kbd>←</kbd> / <kbd>→</kbd> | Turn the page, crossing a chapter edge at either end |
| <kbd>[</kbd> / <kbd>]</kbd> | Jump to the previous/next chapter's first page |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move the cursor one word, clamped to the open page |
| <kbd>v</kbd> | Start a word selection at the cursor |
| <kbd>h</kbd> | Open the highlights list |
| <kbd>Esc</kbd> | Close: a downloaded book sends the open page's span and percent as its `Reading` state; the metadata-only view just closes |

While selecting a word range:

| Key | Does |
|---|---|
| <kbd>←</kbd> / <kbd>→</kbd> | Move the selection's end one word, clamped to `[start, the open page's last word]` |
| <kbd>1</kbd>–<kbd>4</kbd> | Highlight the selection in Yellow / Pink / Blue / Green and clear it |
| <kbd>n</kbd> | Type a note for the selection |
| <kbd>Esc</kbd> | Cancel the selection; the book stays open |

Highlights made on the page, or by the web reader, show inline on their own
words in their swatch colour once the device has them. The highlights list
(<kbd>h</kbd>) names each one's colour and text (plus its note, and
`(not placed)` when the open chapter can't locate it):

| Key | Does |
|---|---|
| <kbd>↓</kbd> / <kbd>↑</kbd> | Move the selected row |
| <kbd>x</kbd> | Delete the selected highlight |
| <kbd>Esc</kbd> | Back to the page |

While editing, <kbd>Enter</kbd> saves and <kbd>Esc</kbd> cancels. Pointing a
device at another server re-wires a token that was wired for the old one; a URL
that is not local (`localhost`, `127.0.0.0/8`, `::1`) is never logged in to, so
give it a token with <kbd>t</kbd>. Until then a sync fails without sending the
old server's token. Edits are turned away while a sync runs. Quitting while an
action runs (a sync, reset, edit or wire) waits for it, so nothing is left half
done; press <kbd>q</kbd> or <kbd>Ctrl-C</kbd> again to quit at once. A running
sync is always waited for, so the pages Omnibus recorded are saved; one more
<kbd>Ctrl-C</kbd> kills the process.

For a second device, give it its own state file; inside the gitignored
`.claude/runtime/`, because a state file holds the device token:

```bash
just kobo --state .claude/runtime/other.json   # the Omnibus device "Mock Kobo (other)"
```

A downloaded book's file is kept beside the state file, in `<state>.books/`
(the default `.claude/runtime/mock-kobo.json` → `.claude/runtime/mock-kobo.books/<id>.kepub.epub`),
so a second device's downloads never collide with the first's.

#### Reader fixture

`test_data/kepub/reader.epub` is a hand-written three-chapter EPUB (ASCII
prose in chapter 1, accented Latin and Mathematical Fraktur text in chapter
2, one short paragraph in chapter 3); `reader.kepub.epub` is kepubify's own
output over it, committed so the walker's tests run with no kepubify on
`PATH`. Regenerate the KEPUB after editing the source EPUB:

```bash
scripts/with-dev-env.sh web kepubify --no-add-dummy-titlepage \
  -o test_data/kepub/reader.kepub.epub -- test_data/kepub/reader.epub
```

Produced with kepubify 4.0.4. `--no-add-dummy-titlepage` matters: without
it, kepubify inserts a blank titlepage as the book's first spine item,
which would shift every chapter's spine index.

### From a script

`mock-kobo serve` runs the same device headless, printing one
`MOCK_KOBO_READY port=<n> hardware_id=<id> state=<path> pid=<pid>` line when it
is listening:

```bash
cargo run -p omnibus-mock-kobo -- serve
```

Both commands take the same options; each flag wins over its env var:

| Flag | Env var | Meaning |
|---|---|---|
| `--url <origin>` | `OMNIBUS_MOCK_KOBO_URL` | The Omnibus origin to sync against; saved in the state file |
| `--token <token>` | `OMNIBUS_MOCK_KOBO_TOKEN` | The device's path token; saved in the state file |
| `--state <path>` | `OMNIBUS_MOCK_KOBO_STATE` | The device's JSON state file |
| `--port <n>` | | The control API port on `127.0.0.1` (default: any free port) |

With no token, the device logs in as the `user:password` in
`OMNIBUS_DEV_SEED_USER`. `mock-kobo --help` lists the rest.

### Firmware behaviours

Every rule `mock-kobo` enforces, named in `mock-kobo::firmware::Quirk`. "Observed"
means seen on a real device or in a linked bug report; "inferred" means derived
from the server code or docs, not seen directly; "unverified" means the rule is
coded in but has never been checked against a real device at all — the table
below names the one such row and [AC4](#ac4-the-highlight-colour-check) is how
to settle it.

| Quirk | Behaviour | Evidence | Status |
|---|---|---|---|
| `ApiToken` | No `x-kobo-apitoken` on `v1/initialization` fails the sync | `kobo/auth.rs` | inferred |
| `GetTestsPost` | `get_tests_request` is POSTed; a non-2xx answer fails the sync | #1499 | observed |
| `StorePaths` | The four firmware store paths are fetched off `api_endpoint`; any non-2xx fails the sync before `library_sync` | #1499 | observed |
| `HardwareId` | Every request carries the device serial as `x-kobo-deviceid` | `kobo/extractor.rs` | observed |
| `PortlessHost` | Every request's `Host` is its URL's host without the port | #2756 | observed |
| `ResourcesOnly` | `library_sync` and `get_tests_request` come only from the adopted `Resources` map, never from `api_endpoint` | #2684 | observed |
| `SyncPaging` | `library_sync` pages are followed while the server says `continue`; past 50 pages the sync never ends | `flows/syncing_a_kobo.md` | inferred |
| `ContributorsDisplay` | Before a download, authors come from `Contributors`; `ContributorRoles` alone shows "Unknown" | #2684 | observed |
| `MetadataNoRedownload` | `ChangedProductMetadata` refreshes a book's metadata and never re-downloads its file | #2684 | observed |
| `RemovalArchives` | A `ChangedEntitlement` with `IsRemoved` archives the book rather than deleting it | `kobo/dto.rs` | inferred |
| `CoverCache` | A cover is cached per `(CoverImageId, width, height)` and never revalidated; widths 149/400/1072 | #2684 | observed |
| `CoverDecode` | Only a JPEG or PNG cover whose content type and magic bytes agree renders; anything else (a WebP, say) shows no cover | #2116 | observed |
| `DownloadFailure` | A non-2xx download, or no answer at all, leaves the book undownloaded and is retried on the next sync, whatever the policy | #2116 | observed |
| `StateArbitration` | Reading status and bookmark are reconciled against the server independently, each adopted only when stamped and strictly newer than the device's own | `kobo/dto.rs` | observed |
| `StatePutResult` | A state PUT's reply must read `Success` on every sub-result, or the write is treated as failed | `kobo/dto.rs` (`StateResponse`) | inferred |
| `AnnotationsUnheld` | Annotations for an undownloaded book are dropped rather than held, and the server keeps reporting the book until it is served once downloaded; `AnnotationsOnDownload` is how a dropped set comes back | #1647 | observed |
| `AnnotationsOnDownload` | A download triggers one unconditional `GET .../annotations`, whether or not `checkforchanges` ever named the book | #1647 | observed |
| `HighlightColor` | A served `highlightColor` hex swatch maps onto the device's `Bookmark.Color` index; anything else lands on yellow (index 0) | #1629 | unverified |

Heights (223/600/1448), quality (90) and greyscale (`false`) are inferred, as
is the content-type/magic-bytes agreement rule and that a non-2xx cover is
never cached. The `If-None-Match: W/"0"` header every checkforchanges-driven
annotations GET sends (the post-download GET sends none at all), and the
sync phase order (handshake → library sync → covers → downloads →
checkforchanges → annotations GETs), are both inferred from
`kobo/reading_services.rs`, not observed on a device. `AnnotationsUnheld`'s
drop for an undownloaded book is observed (#1647); that a *downloaded*
book's set is instead replaced wholesale by each served set, never merged,
is inferred from the same file, not itself observed.

### Annotations

After a library sync, `mock-kobo` POSTs `checkforchanges` and then GETs each
named book's annotations, mapping the served `highlightColor` hex swatch onto
its own `Swatch` the same way firmware is believed to (`HighlightColor`,
above):

| Omnibus colour | Wire hex | Mock `Swatch` | Expected `Bookmark.Color` | Observed `Bookmark.Color` |
|---|---|---|---|---|
| amber | `#F6F3B3` | yellow | 0 | 0 (#1629) |
| green | `#C6E09E` | green | 3 | not yet checked |
| blue | `#B2E1E8` | blue | 2 | not yet checked |
| rose | `#E8AFCF` | pink | 1 | not yet checked |
| violet | `#E8AFCF` | pink | 1 | not yet checked |

#### AC4: the highlight-colour check

This pins the mock's `Swatch` table against the server's own `color_to_kobo`
map — it does **not** prove either one matches a real device. Settling that
needs a `.kobo/KoboReader.sqlite` capture:

1. Back up the device — see the [warning above](#wireless-sync).
2. In the Omnibus web reader, make one highlight in each colour (amber, green,
   blue, rose, violet) on a Kobo-synced book that has a KEPUB.
3. Sync the Kobo, and open the book once so the highlights materialise.
4. Copy `.kobo/KoboReader.sqlite` off the device over USB.
5. Run `SELECT Text, Color FROM Bookmark WHERE VolumeID LIKE '%<uuid>%'`.
6. Record each `Color` in the "Observed" column above.
7. Then either flip `Quirk::HighlightColor` and its table row to **observed**,
   or correct `Swatch`'s discriminants or hex values to match.

If every row reads 0, the firmware ignores `highlightColor` on inbound
annotations entirely, and the quirk becomes "always 0" — which also answers
[#1629](https://github.com/omnibus-library/omnibus/issues/1629)'s open question.

### The control API

Both commands serve a loopback HTTP API over the same device (the terminal UI's
port is in its header). Every reply is `{status, code, message, details}`:

| Route | Replies (`status` `code`) |
|---|---|
| `GET /device` | 200 `ok` |
| `POST /actions/sync` `{"download": "none" \| "all" \| ["<uuid>", …]}` (body optional, defaults to `none`) | 200 `synced` · 400 `invalid_request` · 502 `sync_failed` · 409 `sync_in_progress` · 500 `state_not_saved` |
| `POST /actions/download` `{"books": ["<uuid>", …]}` | 200 `downloaded` · 400 `invalid_request` · 404 `unknown_book` · 409 `not_synced` · 409 `sync_in_progress` · 500 `state_not_saved` · 502 `download_failed` |
| `POST /actions/remove-download` `{"book": "<uuid>"}` | 200 `download_removed` · 400 `invalid_request` · 404 `unknown_book` · 409 `sync_in_progress` · 500 `state_not_saved` |
| `POST /actions/read` `{"book": "<uuid>", "percent": 0..=100, "location": {"source","value"}?}` | 200 `state_sent` · 400 `invalid_request` · 404 `unknown_book` · 409 `not_downloaded` · 409 `sync_in_progress` · 500 `state_not_saved` · 502 `state_failed` |
| `POST /actions/finish` `{"book": "<uuid>"}` | 200 `state_sent` · 400 `invalid_request` · 404 `unknown_book` · 409 `sync_in_progress` · 500 `state_not_saved` · 502 `state_failed` |
| `POST /actions/highlight` `{"book": "<uuid>", "text", "color": "yellow"\|"pink"\|"blue"\|"green", "note"?, "location": {"chapter","start_span","start_char","end_span","end_char"}}` | 200 `annotation_sent` · 400 `invalid_request` · 404 `unknown_book` · 409 `not_downloaded` · 409 `not_synced` · 409 `sync_in_progress` · 500 `state_not_saved` · 502 `annotation_failed` |
| `POST /actions/delete-highlight` `{"book": "<uuid>", "highlight": "<id>"}` | 200 `annotation_sent` · 400 `invalid_request` · 404 `unknown_book` · 404 `unknown_highlight` · 409 `not_synced` · 409 `sync_in_progress` · 500 `state_not_saved` · 502 `annotation_failed` |
| `POST /actions/read-to` `{"book": "<uuid>", "passage"}` | 200 `state_sent` · 400 `invalid_request` · 404 `unknown_book` · 404 `passage_not_found` · 409 `not_downloaded` · 409 `book_unreadable` · 409 `no_kobo_spans` · 409 `sync_in_progress` · 500 `state_not_saved` · 502 `state_failed` |
| `POST /actions/highlight-words` `{"book": "<uuid>", "passage", "color": "yellow"\|"pink"\|"blue"\|"green", "note"?}` | 200 `annotation_sent` · 400 `invalid_request` · 404 `unknown_book` · 404 `passage_not_found` · 409 `not_downloaded` · 409 `not_synced` · 409 `book_unreadable` · 409 `no_kobo_spans` · 409 `sync_in_progress` · 500 `state_not_saved` · 502 `annotation_failed` |
| `GET /requests` | 200 `ok` |
| `PUT /reset` | 200 `reset` · 409 `sync_in_progress` · 500 `state_not_saved` |
| any other path | 404 `not_found` |
| any other method on these paths | 405 `method_not_allowed` |
