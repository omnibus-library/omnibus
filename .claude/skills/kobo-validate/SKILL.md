---
name: kobo-validate
description: Hands-on validation of Kobo sync with the mock Kobo (`mock-kobo`) — drive a fake e-reader against a local dev server or omnibus-test and check position, read status, highlights and shelf delivery both ways, including cross-client interleavings. Use whenever a change touches the Kobo routes, sync state, annotations or shelf delivery; when the user asks "do Kobos still sync?", "validate with mock Kobo", or to reproduce a Kobo bug; or before calling a Kobo-facing change done. Unit tests and the mock-kobo crate's own suite don't count as this.
---

# Validate Kobo sync with the mock Kobo

`mock-kobo` is a fake Kobo firmware that speaks the real Kobo routes ([docs/kobo.md](../../../docs/kobo.md)). This skill drives it through what a reader does, checks each result on the web side over REST, and reports PASS/FAIL per scenario. A green unit suite says the code matches its plan; this says a reader's journey works.

## 1. Pick the server

- **Local:** `just dev-up`, then `source .claude/runtime/env.sh`. With no token, the device logs in as `OMNIBUS_DEV_SEED_USER` (an admin) and wires itself.
- **omnibus-test** (a prod copy, after the `omnibus-test-deploy` user skill): the device needs a token. Sign in as the QA account with `POST /api/auth/login` `{"username","password","client_kind":"bearer"}` and use the returned token as `Authorization: Bearer`. Read the credentials from a mode-0600 file, never into the transcript. The QA account must be an admin, or metadata reads answer 403 and look like product bugs.

## 2. Set up

Over REST, as the QA user:

1. A shelf with two small single-file EPUBs: `POST /api/shelves` `{"kind":"manual","name":"Kobo QA <HHMMSS>","book_uuids":[…]}`, then `PATCH /api/shelves/<id>` `{"sync_to_kobo":true}`. Put the seconds in every name: same-minute names collide (409) on a rerun.
2. A device: `POST /api/account/kobo-devices` `{"name":"kobo-qa <HHMMSS>","kind":"kobo"}`. Its `token` is a credential: keep it in an owner-only file, and grep `mock-kobo`'s log for it before you finish.
3. Start the device headless and read its control port from the ready line:

```bash
OMNIBUS_MOCK_KOBO_TOKEN=<token> cargo run -q -p omnibus-mock-kobo -- serve --url <origin> --state <scratch>/kobo.json
# prints: MOCK_KOBO_READY port=<n> hardware_id=… state=… pid=…
```

A device gets every synced shelf's books, and the seeded admin's **Kobo library** smart shelf holds every EPUB, so turn `sync_to_kobo` off on every other shelf holding either book, or scenario 6 never archives them. Record what you'll change, so you can put it back: each book's epub position and read status, and those shelves' flags.

## 3. Drive it

The control API listens on `127.0.0.1:<port>`. Every action answers `{"code", "message", "details"}`:

| Route | Body | Does |
|---|---|---|
| `GET /device` | | the device's library: per book `archived`, `downloaded`, `reading.status`, `reading.bookmark` |
| `POST /actions/sync` | `{}` | one full sync → `synced` |
| `POST /actions/download` | `{"books":[uuid…]}` | download as KEPUB → `downloaded` |
| `POST /actions/read-to` | `{"book","passage"}` | read to a passage (six words from a `koboSpan` in the device's own file) and push state → `state_sent` |
| `POST /actions/read` | `{"book","percent","location"?}` | read to a percent (optionally a `{"source","value"}` KoboSpan) → `state_sent` |
| `POST /actions/finish` | `{"book"}` | finish a book → `state_sent` |
| `POST /actions/highlight-words` | `{"book","passage","color","note"}` | highlight a passage |
| `POST /actions/highlight` | `{"book","text","color","note"?,"location"}` | highlight an exact span range |
| `POST /actions/delete-highlight` | `{"book","highlight"}` | delete a highlight by id |
| `GET /requests` · `PUT /reset` | | the requests the device made; wipe the device |

Check every result from the web side (`GET /api/progress/<uuid>`, `GET /api/read-status/<uuid>`, the book's highlights). Never trust the device's own view alone.

## 4. Scenarios

Run these, each with an observable pass condition:

1. **Delivery:** after a sync both shelf books are in the library, and they download as KEPUB (the file holds `koboSpan`s).
2. **Position, device → web:** `read-to` a passage, sync. The web shows the same percent and a `kobo_location`.
3. **Position, web → device:** post a web position at least 10 points away, sync. The device's bookmark moves to it.
4. **Read status both ways:** finish on the device → the web shows `finished`. Mark it `reading` on the web → the device follows.
5. **Highlights both ways:** a device highlight reaches the web with its colour and note. A web highlight reaches the device. A delete on either side disappears from the other.
6. **Removal:** turning the shelf's sync off archives its books on the next sync.

Then the **cross-client interleavings**, where one client changes one field and the other client then acts on a different one. These catch what one-way flows miss:

- web marks **Unread**, then the device reads → the web shows `reading` again;
- web moves the position, then the device changes the status (and the reverse): neither change erases the other;
- a web change in the **same second** as a sync (known whole-second edge): report it if it fails, don't sleep it away.

## 5. Clean up and report

Restore what §2 recorded, then delete the run's shelf, device and highlights. Some things can't be undone: reading sessions and `finished_at`. Say so.

A rerun that breaks on state an earlier run left behind is a **product signal** first: a real reader's library is full of old state. Work out why before you reset the account.

Report one line per scenario: `PASS|FAIL <scenario>: <evidence>`, plus anything skipped and why, and whether the token appeared in any log.
