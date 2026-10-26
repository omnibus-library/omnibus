---
name: koreader-validate
description: Hands-on validation of KOReader sync with a real KOReader in Docker — sync shelves through the Omnibus plugin, read, highlight, and check position, read status and highlights both ways against a local dev server or omnibus-test, including cross-client interleavings. Use whenever a change touches the KOReader plugin, the `/koreader` or `/kosync` routes, reading state or highlights; when the user asks "does KOReader still sync?", wants to try KOReader against a server, or reports a KOReader bug; or before calling a KOReader-facing change done. `just koreader-e2e` passing doesn't count as this.
---

# Validate KOReader sync

A real KOReader runs in Docker and syncs through the Omnibus plugin ([docs/koreader.md](../../../docs/koreader.md)). This skill drives it through what a reader does, checks each result from the web side, and reports PASS/FAIL per scenario. The `just koreader-e2e` lane proves its scripted scenarios; the bugs it misses live in the interleavings below.

## 1. Pick the server and start KOReader

- **Local:** `just dev-up`, then `just koreader`. It opens KOReader in a browser tab through noVNC, already linked as `OMNIBUS_DEV_SEED_USER`, with the plugin installed. `--home <dir>` is a second device. Docker must be running; on Linux, a permission error after joining the `docker` group means the running session predates the group.
- **omnibus-test** (after the `omnibus-test-deploy` user skill): `just koreader` only links to a loopback dev server, so run the image by hand. Register a KOReader device as the QA user (`POST /api/account/kobo-devices` `{"name":"<name> <HHMMSS>","kind":"koreader"}`), download its plugin (`GET /api/account/kobo-devices/<id>/koreader-plugin`, a zip that carries the server URL and the device token: treat it as a password), unzip it into `<home>/plugins/`, then:

```bash
deb="$(awk '$2 ~ /_amd64\.deb$/ {print $2}' ui_tests/koreader/koreader.sha256)"
docker build -t "omnibus-koreader:$deb" ui_tests/koreader
export VNC_PASSWORD="$(openssl rand -hex 6)"   # open http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale&password=$VNC_PASSWORD
docker run --init --rm --network host -e NOVNC_LISTEN=127.0.0.1:6080 -e VNC_PORT=5999 \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e XDG_DOCUMENTS_DIR=/ko-home/books \
  -e VNC_PASSWORD -v "<home>:/ko-home" "omnibus-koreader:$deb" koreader-vnc
```

`--network host` needs a native Linux engine. On Docker Desktop, publish `-p 127.0.0.1:6080:6080` instead.

Use an **admin** QA account (a non-admin gets 403 on metadata reads, which looks like a product bug), keep its credentials in a mode-0600 file, and put seconds in every name you create. Same-minute names collide on a rerun.

## 2. Set up

A shelf with two small EPUBs and its sync toggle on (`POST /api/shelves`, then `PATCH /api/shelves/<id>` `{"sync_to_kobo":true}`). Record each book's epub position, read status and highlights so you can put them back. In KOReader: **Tools › Omnibus › Sync now**.

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
- a second device (`just koreader --home …/second`) reading the same book.

## 5. Clean up and report

Restore what §2 recorded, delete the run's shelf, devices and highlights, and stop the container with one Ctrl-C (KOReader exits cleanly and saves its settings). Reading sessions can't be undone: say so. Grep KOReader's output for the device token.

A rerun that breaks on state an earlier run left behind is a **product signal** first, since a real reader's library is full of old state. Work out why before resetting anything.

Report one line per scenario: `PASS|FAIL <scenario>: <evidence>`, plus anything skipped and why.
