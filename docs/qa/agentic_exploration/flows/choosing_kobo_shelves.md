# Choosing which shelves go to your Kobo

| | |
|---|---|
| **Runs** | on its own |
| **Owner-only** | no — your own shelves and device |
| **Surfaces** | kobo |
| **Actions** | `kobo.sync`, `kobo.show`, `kobo.requests`, `shelf.create`, `shelf.edit` |

Wireless sync is never whole-library: only shelves marked **Sync to Kobo** go
to your device, and the device follows the shelves as they change. This flow
turns shelves on and off and checks the device follows, one `act sync` at a
time. It builds on [syncing_a_kobo.md](syncing_a_kobo.md), which proves the
first shelf arrives; the recipe for journalling a sync is there too.

It is drawn after that flow, but it must also stand alone: if your device is
still empty, step 1 sets up the first shelf itself.

## Steps

Use only books that were in the library before the run started, on every shelf
here: one another agent uploads or merges this run can change under you.

1. **Shelf A on the device.** If the previous flow left a hand-picked shelf
   with **Sync to Kobo** On, that is A. Otherwise make one with three books,
   switch it On under **Edit shelf**, run `act sync`, and journal the sync.
   Note which books the device holds (`act show`).
2. **Turn a second shelf on.** Make a hand-picked shelf B with three books, one
   of them also on A. Open **Edit shelf**, switch **Sync to Kobo** On, save,
   and reload to confirm it stuck. Journal `shelf.create` and `shelf.edit`
   with `sync_to_kobo` as `{"old": false, "new": true}`. Run `act sync`, then
   `act show`: B's books have joined, A's are still there, and the book on both
   appears once.
3. **Turn the first shelf off.** Switch A's **Sync to Kobo** Off, save, journal
   `shelf.edit` (`{"old": true, "new": false}`), then `act sync` and
   `act show`. The books only A held show `"archived": true`; the book on both
   shelves, and B's books, stay as they were.
4. **An empty shelf still offers the opt-in.** Make a hand-picked shelf C with
   no books. Open **Edit shelf**: the **Sync to Kobo** toggle is offered even
   though the shelf is empty. Switch it On and save; journal `shelf.create` and
   `shelf.edit`. Nothing arrives for it: after the next sync the device library
   is what it was.
5. **The wishlist offers no opt-in.** Your wishlist shelf has no Edit control
   at all, which is stronger than a form leaving the toggle out. Check that
   once, and compare with shelf C, so you know you are seeing a system shelf
   and not an empty one.
6. **A Smart shelf, judged by eye.** The audit leaves a sync unjudged while a
   Smart shelf is On, so you are the judge here. Make a Smart shelf, switch
   **Sync to Kobo** On, `act sync`, and check with `act show` that its current
   books arrived. Then switch it Off again before the last step. Journal
   `shelf.create` and both edits as `shelf.edit`.
7. **End on a sync.** After your last shelf edit, run `act sync` and `act show`
   and journal the `kobo.sync` with the recipe in
   [syncing_a_kobo.md](syncing_a_kobo.md#journalling-the-sync). The audit
   judges your last `kobo.sync` against your Kobo-synced shelves, and a shelf
   write after it leaves it unjudged. Journal every sync you run; only the last
   one counts.

## Journal

`shelf.create` and `shelf.edit` with the shelf's `name` and, on every edit that
touches the opt-in, `sync_to_kobo` as `{"old": …, "new": …}`. `kobo.sync` after
each sync, from `act show`, as in [syncing_a_kobo.md](syncing_a_kobo.md).
`kobo.show` and `kobo.requests` as looks. Never journal the device endpoint URL
or token.

## Pass

- A shelf turned On has its books on the device after the next sync, and the
  books A already sent stay.
- A shelf turned Off has its books archived on the device after the next sync,
  except those still on a shelf that is On.
- A book on two shelves is never duplicated or archived while either is On.
- An empty hand-picked shelf offers the opt-in and adds nothing.
- The wishlist offers no opt-in.

## Fail

- A book is archived while a Kobo-synced shelf still holds it.
- Turning a shelf Off leaves its books un-archived, or archives books it never
  held.
- The wishlist offers the opt-in.
- A book appears twice.

## Sharp edges

- **Nothing changes until you sync.** The device does not follow a shelf
  edit by itself; `act sync` is the only thing that moves it, and the audit
  compares your **last** sync with your shelves, so edit first and sync last.
- The opt-in is not on the create form, so a shelf is created and then
  reopened.
- A Smart shelf's members move with the library, so the audit leaves a sync
  unjudged while a Smart shelf is On. Use hand-picked shelves here.
