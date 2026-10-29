---
name: koreader-validate
description: Hands-on validation of KOReader sync with a real KOReader in Docker — sync shelves through the Omnibus plugin, read, highlight, and check position, read status and highlights both ways against a local dev server or omnibus-test, including cross-client interleavings. Use whenever a change touches the KOReader plugin, the `/koreader` or `/kosync` routes, reading state or highlights; when the user asks "does KOReader still sync?", wants to try KOReader against a server, or reports a KOReader bug; or before calling a KOReader-facing change done. `just koreader-e2e` passing doesn't count as this.
---

# Validate KOReader sync

A real KOReader runs in Docker and syncs through the Omnibus plugin ([docs/koreader.md](../../../docs/koreader.md)). This skill drives it through what a reader does, checks each result from the web side, and reports PASS/FAIL per scenario. The `just koreader-e2e` lane proves its scripted scenarios; the bugs it misses live in the interleavings below.

## 1. Pick the server and start KOReader

- **Local:** `just dev-up`, then `just koreader --local`. It opens KOReader in a browser tab through noVNC, linked as `OMNIBUS_DEV_SEED_USER` through a device named **Dev KOReader**, with the plugin, the OPDS catalog and stock Progress sync set up. Every launch is a fresh home, removed on exit. Docker must be running; on Linux, a permission error after joining the `docker` group means the running session predates the group.
- **omnibus-test** (after the `omnibus-test-deploy` user skill): register a KOReader device as the QA user (`POST /api/account/kobo-devices` `{"name":"<name> <HHMMSS>","kind":"koreader"}`), download its plugin (`GET /api/account/kobo-devices/<id>/koreader-plugin`, a zip that carries the server URL and the device token: treat it as a password), then `just koreader --plugin <zip>`. That sets up the plugin alone, with no OPDS catalog or Progress sync.

`--local` turns on stock Progress sync's automatic sync, which carries the position over `/kosync` by itself and hides a broken plugin. Turn it off in KOReader before the plugin scenarios, and back on only for scenario 6.

Use an **admin** QA account (a non-admin gets 403 on metadata reads, which looks like a product bug), keep its credentials in a mode-0600 file, and put seconds in every name you create. Same-minute names collide on a rerun.

## 2. Set up

A shelf with two small EPUBs and its sync toggle on (`POST /api/shelves`, then `PATCH /api/shelves/<id>` `{"sync_to_kobo":true}`). A device gets every synced shelf's books, and the seeded admin's **Kobo library** smart shelf holds every EPUB, so turn `sync_to_kobo` off on every other shelf holding either book, or removal never removes them. Record those flags and each book's epub position, read status and highlights so you can put them back. In KOReader: **Tools › Omnibus › Sync now**.

## 3. Check from the web side

Never trust KOReader's own screen alone. As the QA user (`POST /api/auth/login` with `"client_kind":"bearer"`), read `GET /api/progress/<uuid>`, `GET /api/read-status/<uuid>` and the book's highlights. To script a device write without the UI, call the plugin's own routes with the device token as `Authorization: Bearer`:

- `PUT /koreader/v1/books/<uuid>/state` `{"percent", "event_at", "xpointer"?, "status"?}` (`status` is KOReader's `reading` / `complete`);
- `POST /koreader/v1/books/<uuid>/annotations` `{"upserts":[…]}`.

## 4. Scenarios

1. **Delivery:** Sync now puts both shelf books in KOReader's `Omnibus` folder. Turning the shelf's sync off removes them on the next sync.
2. **Position, device → web:** read into a chapter and close the book. The web shows that percent, and a CFI when the XPointer maps.
3. **Position, web → device:** move the position on the web, then open the book in KOReader. It lands on the web's place with no prompt.
4. **Read status:** finish in KOReader → the web shows `finished`.
5. **Highlights both ways:** a KOReader highlight and note reach the web, a web highlight reaches KOReader, and a delete on either side disappears from the other.
6. **Progress sync (kosync), if touched:** stock **Progress sync** pointed at `<origin>/kosync` with a password from Settings › Devices pushes and pulls the position.

Then the **cross-client interleavings**, where one client changes one field and the other client then acts on a different one:

- web marks **Unread**, then KOReader reads further → the web shows `reading` again;
- web moves the position while KOReader changes the status (and the reverse): neither erases the other;
- an offline change made in KOReader (Wi-Fi off) followed by a newer web change: the newer one wins once KOReader reconnects;
- a second device reading the same book: a second KOReader device's zip in another `just koreader --plugin` (omnibus-test only: the launcher refuses a loopback zip, and two `--local` launches are the same **Dev KOReader**).

## 5. Clean up and report

Restore what §2 recorded, delete the run's shelf, devices and highlights, and stop the container with one Ctrl-C (KOReader exits cleanly and saves its settings). Reading sessions can't be undone: say so. Grep KOReader's output for the device token.

A rerun that breaks on state an earlier run left behind is a **product signal** first, since a real reader's library is full of old state. Work out why before resetting anything.

Report one line per scenario: `PASS|FAIL <scenario>: <evidence>`, plus anything skipped and why.
