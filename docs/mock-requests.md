# mock-requests

`mock-requests` (the `mock-requests/` crate, `omnibus-mock-requests`) is a fake
Prowlarr and fake download clients, so a book request can run from search to
"Ready" on a dev machine with no real indexer, torrent client or usenet account.
It is dev tooling: out of the default workspace members, never part of the server.

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
and the server's are both the downloads folder), and has the server test both. It
stays pointed at the mock after the mock exits. It **refuses** to run when the
server already points Prowlarr or the download client at anything but a previous
mock wiring (the saved login is `mock`, the saved key is the mock's), loopback
included, because the settings read masks secrets and a real service's could not be
restored. Clear the connection in Settings, Requests first. If requests are off it
says to set `OMNIBUS_BOOK_REQUESTS=1` and `just dev-bounce`.

Two more refusals protect what it must not touch. `--local` asks the server on the
published port for its `repo_root` (`/api/_health`) and stops unless that is this
checkout, since a stale `.claude/runtime/port` can name another worktree's server. And
it stops when the server's ebook or audiobook library sits under this checkout's
`test_data/`: an import would add the downloaded book to the committed fixtures
(`git add .` would then commit it). Point the library elsewhere, or use
`ios-validate.sh server up --requests`, which serves clones.

Without `--local` or `--server`, the mock just serves and you enter its address
and the key in Settings, Requests yourself.

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

## Caveats

- State is in memory. Restarting the mock strands on-its-way requests: their
  downloads are gone and the server calls them `stopped_moving`.
- AZW3 versions appear in Choose a version only when the server's `ebook-convert`
  runs; otherwise the ranker drops them.
- An import files the book into the dev server's own library, so a request on a
  dev server changes its library. `ios-validate.sh server up --requests` uses
  clones of the libraries for this reason.
- iOS tours: `scripts/ios-validate.sh server up --requests` starts the mock beside
  the scratch server (qBittorrent only) and exports its address as
  `OMNIBUS_TOUR_REQUESTS`.

## Tests

`cargo nextest run -p omnibus-mock-requests`. Use nextest, not `cargo test`: the
clients pool one HTTP client per process, and a connection can die with an earlier
test's runtime. No fixtures are needed; the tests write temp payloads.
