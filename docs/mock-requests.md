# mock-requests

`mock-requests` (the `mock-requests/` crate, `omnibus-mock-requests`) is a fake
Prowlarr, fake download clients and a fake ntfy, so a book request can run from
search to "Ready" on a dev machine with no real indexer, torrent client or usenet
account, and the notification it sends can be read without an ntfy server or a
phone. It is dev tooling: out of the default workspace members, never part of the
server.

## What it fakes

Everything is on **one loopback port** (`127.0.0.1`, any free port unless
`--port` says otherwise). The paths don't collide, so all four download clients
are live together and the server's request settings choose between them.

| Face | Paths |
|---|---|
| Prowlarr v1 | `/api/v1/system/status`, `/api/v1/indexerstatus`, `/api/v1/search`; the API key is `mock-requests` |
| qBittorrent Web API v2 | `/api/v2/*` |
| Transmission RPC | `/transmission/rpc` (with the 409 session-id handshake) |
| SABnzbd | `/api` (`mode=queue`, `history`, `addfile`) |
| NZBGet | `/jsonrpc` |
| NZB files | `/nzb/{id}`, which the server fetches and uploads to SABnzbd or NZBGet |
| ntfy (JSON publishing) | `POST /ntfy` (or `/ntfy/`), so its server URL is `http://127.0.0.1:<port>/ntfy`; the token is `tk_mock-requests` ([Notifications](#notifications-ntfy)) |
| Control API | `/_mock` (below) |

Every client accepts any login (wiring saves `mock` / `mock`; for SABnzbd the
password is its API key). Searches are answered **from the query**, so any title
works with no catalogue file: `<query> EPUB` and `<query> AZW3` for an ebook,
`<query> M4B` for an audiobook, each once as a torrent (a magnet link) and once as
usenet.

A finished download is a real file copied from `test_data/` into the downloads
folder: `epubs/generated/alpha.epub` for either ebook format, and the first `.m4b`
under `audiobooks/public_domain` for an audiobook (run `just fixtures` for it). The
server imports it from there.

## Run it

```bash
just dev-up                    # with OMNIBUS_BOOK_REQUESTS=1 in .env
just mock-requests --local     # prints MOCK_REQUESTS_READY port=… downloads=… pid=…
```

`--local` logs in to this worktree's dev server as `OMNIBUS_DEV_SEED_USER`, saves
the mock as the Prowlarr and download client connections (the client's folder
and the server's are both the downloads folder), and has the server test both.
Then it saves the `Mock ntfy` notification connection
([Notifications](#notifications-ntfy)) and has the server send it a test; if that
fails it prints a `warning:` line saying why and serves on, since the request
connections are already saved. It stays pointed at the mock after the mock exits. It **refuses** to run when the
server already points Prowlarr or the download client at anything but a previous
mock wiring (on this machine, with the login `mock` and the mock's key), loopback
included, because the settings read masks secrets and a real service's could not be
restored. Clear the connection in Settings, Requests first. If requests are off it
says to set `OMNIBUS_BOOK_REQUESTS=1` and `just dev-bounce`.

Two more refusals protect what it must not touch. `--local` asks the server on the
published port for its `repo_root` (`/api/_health`) and stops unless that is this
checkout, since a stale `.claude/runtime/port` can name another worktree's server. And
it stops when the server's ebook or audiobook library is a relative path (the mock
can't see the server's working folder) or is or sits in a checkout's `test_data/`
folder (any letter case, symlinks followed, a git checkout beside it): an
import would add the downloaded book to the committed fixtures (`git add .` would then
commit it). A `test_data` folder elsewhere is fine. Point the library elsewhere, or use
`ios-validate.sh server up --requests`, which serves clones.

Without `--local` or `--server`, the mock just serves and you enter its address
and the key in Settings, Requests yourself, and the ntfy connection's server URL
and token under Administration › Notifications (`/admin?section=notifications`) on
the web, You › Server settings › Notifications on iOS, or
`POST /api/admin/notifications/connections`.

| Flag | Default | Does |
|---|---|---|
| `--port <n>` | any free port | the port on `127.0.0.1` |
| `--downloads <dir>` | `.claude/runtime/mock-requests/downloads` | where finished downloads are written; created if missing |
| `--test-data <dir>` | `test_data` | where the payload files are found |
| `--download-secs <n>` | `30` | how long a download takes to finish |
| `--local` | | wire this worktree's dev server (port from `.claude/runtime/port`) |
| `--server <origin>` | | wire the Omnibus at this loopback origin |
| `--client <kind>` | `qbittorrent` | which client to wire: `qbittorrent`, `transmission`, `sabnzbd` or `nzbget`; needs `--local` or `--server` |

To switch clients afterwards, pick another in Settings, Requests (the address and
login are the same), or run again with a different `--client`.

## Control API

Plain JSON over HTTP, no auth, on the same port.

| Route | Body | Does |
|---|---|---|
| `GET /_mock` | | the search mode, the outcome and seconds later downloads get, and every download (`id`, `client`, `progress`, `outcome`) |
| `PUT /_mock/search` | `{"mode": "results" \| "empty" \| "fail"}` | what a search answers: the catalogue, an empty list, or an HTTP 500 |
| `PUT /_mock/downloads` | `{"outcome"?: "complete" \| "stall" \| "fail" \| "junk", "secs"?: n}` | applies to every unfinished download and every later one; a field left out keeps its value |
| `GET /_mock/ntfy` | | what publishes are answered with (`fail`, `times`, `retry_after`) and every publish kept, oldest first (`messages`) |
| `PUT /_mock/ntfy` | `{"fail": "server_error" \| "rate_limited" \| "unauthorized" \| null, "times"?: n, "retry_after"?: secs}` | replaces the whole forcing state: the next `n` publishes (every one, without `times`) are answered with a 500, a 429 or a 401, with `Retry-After: secs` when given; `{"fail": null}` alone answers normally again. `fail` is required, and `times` or `retry_after` without a failure is refused `422` |
| `DELETE /_mock/ntfy` | | forgets every publish kept; a forced failure stays |

`GET /_mock` also carries `ntfy`: the same `fail`, `times` and `retry_after`, and
`received`, how many publishes are kept.

Progress is worked out when a client reads it, so there are no timers: `stall`
freezes the bar where it is and `complete` resumes from there. `fail` makes the
client report an error. `junk` runs to the end but the folder holds only a
`README.txt`, which cannot be imported.

## Reach each state

```bash
M=http://127.0.0.1:<port>   # from the ready line
put() { curl -sf -X PUT -H 'content-type: application/json' "$M$1" -d "$2"; }
```

| State | How |
|---|---|
| Looking, Choose a version, On its way, Ready | request a book; the bar moves over `--download-secs` |
| `not_found` | `put /_mock/search '{"mode":"empty"}'`, then request |
| `search_failed` | `put /_mock/search '{"mode":"fail"}'`, then request |
| `stopped_moving` | `put /_mock/downloads '{"outcome":"fail"}'` before or during the download |
| `couldnt_add` | `put /_mock/downloads '{"outcome":"junk"}'` before the download |
| a stall | `put /_mock/downloads '{"outcome":"stall"}'` freezes the bar. The server waits 12 hours before calling a stall stopped, so use `fail` to get `stopped_moving` |

Undo with `{"mode":"results"}` and `{"outcome":"complete"}`; a download that
already finished is not touched by either.

## Notifications (ntfy)

`--local` saves an enabled notification connection named `Mock ntfy`: server URL
`http://127.0.0.1:<port>/ntfy` (a sub-path, as an ntfy behind a reverse proxy has),
topic `omnibus-requests`, token sign-in with `tk_mock-requests`, priority 4, the tag
`books`, and the event "a request needs a version picked". A later run updates that
connection in place, whatever port the mock had then, sending the token again: the
server keeps a saved token only for the address it was saved for. The mock's own
connection is the one named `Mock ntfy` on this machine, with a path ending in
`/ntfy` and token sign-in with a token saved. A connection of that name that isn't,
or two that are, are left alone and the wiring says so in its `warning:` line:
rename or delete the one that is in the way and run it again. The server's test
send is the first message the mock records, so look past `messages[0]` for a
request's.

The fake takes ntfy's JSON publishing (a body of `topic`, `title`, `message`,
`priority`, `tags` and `click`), the form the server sends, and answers as an ntfy
that requires sign-in would. A publish is accepted only when it signs in with
`Bearer tk_mock-requests` or basic `mock` / `mock`. One with no sign-in is refused
`403` with ntfy's error body, `{"code":40301,"http":403,"error":"forbidden"}`; one
with any other sign-in is refused `401`,
`{"code":40101,"http":401,"error":"unauthorized"}`. A body that is not publish
JSON or has a field of the wrong type (`40017`), has no valid topic (`40009`), or
has a priority outside 0 to 5 (`40007`) is refused `400` in the same shape. A
success answers `200` with the message back and its `id`.

Every publish is kept, refused ones too, up to the newest 200: its `id`, `at`
(Unix seconds), the `status` it was answered with, the refusal's `error`, the
`auth` it carried (`scheme`: `bearer`, `basic`, `none` or `other`; `matched`; and
the raw `header`), and `topic`, `title`, `message`, `priority`, `tags` and `click`.
A refused body keeps every field that could be read: a priority of 300 is recorded
as 300, and only a field of the wrong type is left `null`.

With `M` and `put` from [Reach each state](#reach-each-state):

```bash
curl -s $M/_mock/ntfy | jq '.messages[-1]'              # the latest publish
put /_mock/ntfy '{"fail":"unauthorized","times":1}'     # refuse the next publish with a 401
put /_mock/ntfy '{"fail":"rate_limited","retry_after":120}'  # 429s until reset
put /_mock/ntfy '{"fail":"server_error","times":3}'     # 500 the next three
put /_mock/ntfy '{"fail":null}'                          # answer normally again (the whole body)
curl -s -X DELETE $M/_mock/ntfy                          # forget what was kept
```

To see a real notification, sign in as a reader who may ask for books but not pick
versions (Administration › People: **Ask for books** on, **Pick versions** off) and
request a book. When the search reaches Choose a version the server queues the
notification and sends it within seconds; it shows in `/_mock/ntfy` with the book in
`message` and, when a public server URL is set, `click` pointing at
`/requests?book=<uuid>`. An admin's own requests, or those of a reader who may pick,
send nothing.

What the server does with a forced failure:

- **500 or 429**: it tries again, 30 seconds after the first try and doubling up to
  an hour, or after the `Retry-After` when that is longer: about five hours in all,
  as the twelfth failed try gives up. Each try shows in `/_mock/ntfy` with its status.
- **401 (or 403)**: it gives up at once. The connection's last delivery shows it
  failed, with the mock's answer as the reason: under Administration › Notifications
  on the web, You › Server settings › Notifications on iOS, and in
  `GET /api/admin/notifications/connections`.
- A notification still waiting for a retry is dropped unsent, and leaves no failed
  last delivery, when its connection is turned off or its request is picked,
  cancelled or restarted meanwhile.
- A test send, wiring's own included, reports the mock's answer at once and never
  changes the last delivery.

## Caveats

- State is in memory. Restarting the mock strands on-its-way requests: their
  downloads are gone and the server calls them `stopped_moving`.
- AZW3 versions appear in Choose a version only when the server's `ebook-convert`
  runs; otherwise the ranker drops them.
- An import files the book into the dev server's own library, so a request on a
  dev server changes its library. `ios-validate.sh server up --requests` uses
  clones of the libraries for this reason.
- iOS tours: `scripts/ios-validate.sh server up --requests` starts the mock beside
  the scratch server (qBittorrent only, and the `Mock ntfy` connection) and exports
  its address as `OMNIBUS_TOUR_REQUESTS`.
- The ntfy record and a forced failure live in memory too: a restarted mock has
  neither, and the connection it saved keeps the old port until the next wiring.

## Tests

`cargo nextest run -p omnibus-mock-requests`. Use nextest, not `cargo test`: the
clients pool one HTTP client per process, and a connection can die with an earlier
test's runtime. No fixtures are needed; the tests write temp payloads. The ntfy tests
send with the server's own `render` and `deliver`, and drain a queued notification
through the outbox on an in-memory database.
