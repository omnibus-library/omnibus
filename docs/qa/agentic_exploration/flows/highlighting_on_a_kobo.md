# Highlighting on a Kobo

| | |
|---|---|
| **Runs** | on its own |
| **Owner-only** | no — your own shelves and device |
| **Surfaces** | kobo |
| **Actions** | `kobo.sync`, `kobo.show`, `kobo.download`, `highlight.create`, `highlight.delete` |

Drawn after [syncing_a_kobo](syncing_a_kobo.md), so you already have a shelf
on your Kobo-synced device. This flow proves the highlight channel over
Reading Services: a highlight made **on the device** reaches the browser, and
a delete made on the device removes it there too. Every device step goes
through `scripts/explore/kobo.sh act --agent <n>` — the only tool that ever
touches the device's control API directly.

## Steps

1. **Sync, then download a book.** `act sync`, then read `details.library`
   from `act show` for a book on one of your Kobo-synced shelves that isn't
   an audiobook-only book. `act download <uuid>` it.
2. **Make two highlights in different colours.**
   `act highlight <uuid> blue kobo.1.1 0 12 "a passage"`, then
   `act highlight <uuid> pink kobo.2.1 0 20 "another passage" "a thought"`
   (the second carries a note; journal its colour as `rose` — Omnibus's
   name for the wire swatch `pink`). Each reply's `code` is `annotation_sent`.
   Journal each as `highlight.create --surface kobo`, `params`
   `{"text": "<the verbatim text>", "colour": "<the colour>"}`, plus
   `"note_text"` when you gave one, `target` the book's uuid.
3. **Check the browser agrees.** Open the book's detail page: it lists both
   passages, and the note is attached to the one you gave it to.
4. **Delete one.** `act show` and take one highlight's `id` from
   `details.library[<uuid>].annotations`. Then
   `act delete-highlight <uuid> <id>`. The reply's `code` is
   `annotation_sent`. Journal it as `highlight.delete --surface kobo`,
   `params` `{"highlight_text": "<its verbatim text>"}`, `target` the book's
   uuid. The detail page no longer lists it.
5. **End on a sync:** `act sync`, then `act show` once more.
   `details.library[<uuid>].annotations` is now exactly the surviving
   highlight — the server served the device's own set back, since the
   device already held the book.

## Journalling

- `kobo.sync`, `kobo.show` and `kobo.download` follow
  [kobo_lane.md](../../kobo_lane.md#journalling), same as every other flow.
- A device highlight or delete is `highlight.create` / `highlight.delete`
  with `--surface kobo`, exactly as a web agent would journal them —
  **never** `kobo.highlight`: it is one of the audit's own qualifier words,
  so an entry named that way would be silently read as a look and assert
  nothing, the same trap `kobo.read` is for a position change (see
  [reading_on_a_kobo.md](reading_on_a_kobo.md)).

## Pass

- Both highlights made in step 2 appear on the detail page, each in the
  colour it was given, the note attached to the right one.
- The deleted highlight in step 4 is gone from the detail page.
- The surviving highlight's text, note and colour match what step 2 sent,
  after the round trip through step 5's sync.

## Fail

- A highlight made in step 2 is missing from the detail page, or carries
  the wrong colour or note.
- The deleted highlight in step 4 still shows on the detail page.
- `act show`'s `annotations` after step 5 disagrees with what the browser
  shows for the surviving highlight.

## Sharp edges

- **Never journal `kobo.highlight`.** See Journalling above.
- **A device highlight made here carries no position until
  [#2738](https://github.com/omnibus-library/omnibus/issues/2738).** The
  reader can't place it in the text yet — that is not a defect to report,
  just this slice's known limit.
- **A `dropped_annotations` count on an undownloaded book is the firmware
  rule, not a loss.** If you see one in `act show`, it means a book held
  annotations it hasn't downloaded yet to hold, not that anything vanished.
