---
name: ui-validate
description: End-to-end recipe for validating omnibus UI changes in a real browser — brings up a port-walking dev server, logs in as the seeded admin, polls /api/_health for the restart signal, and verifies the change against its flow doc's Pass criteria via snapshot/screenshot. Triggers when you need to drive the running web app to verify a change, when another agent may already own :3000, when the page isn't reloading after an edit, or when login state is uncertain.
---

# Validate a UI change in the browser

This is the canonical flow for validating any change to the React web client (`frontend-js/`). Uses **Claude Preview** (`mcp__Claude_Preview__preview_*`) — each agent gets its own isolated headless Chromium, so parallel agents across workspaces never share a browser. It assumes nothing about the current server state — safe to re-run.

## 1. Bring the server up (idempotent)

```bash
just dev-up
```

What this does (`scripts/dev-server-up.sh`):

- Probes `GET /api/_health` starting at `$PORT` (this worktree's window base — 3000 for the main checkout, hash-derived otherwise), walking up to `PORT+9`.
- Reuses an existing omnibus server on a probed port **only when its `repo_root` matches this worktree** — a sibling worktree's server is skipped, not silently shared.
- Fails fast with a remediation line if every port in range is held by a foreign process.
- Builds the React client into `frontend-js/dist` when it is missing or older than its sources (on reuse too: the running server reads the files from disk).
- Starts `cargo run -p omnibus` in the background with `OMNIBUS_REACT_DIR` pointing at that build (daemonized so it survives the agent shell); output goes to `.claude/runtime/server.log`, PID to `.claude/runtime/server.pid`.
- Requires `OMNIBUS_DEV_SEED_USER` (sourced from `.env`). If unset, prints `"copy .env.example to .env and re-enter nix develop"` and exits 1.
- Writes `.claude/runtime/port` and `.claude/runtime/env.sh`.
- Emits one parseable line on stdout: `OMNIBUS_DEV_READY port=<n> repo_root=<path> build_id=<n> action=<reuse|started> pid=<n>`.

If a server is already up for this workspace, `just dev-up` returns in under 2s with `action=reuse`. If it's not, the first run takes a minute or more while cargo and Vite build. **Don't kill and restart** a healthy server between sessions — the long-running model is intentional. The server never rebuilds itself: use `just dev-bounce` after a Rust change or a sqlx migration.

If it exits 1 telling you to set `OMNIBUS_DEV_SEED_USER`:

```bash
cp .env.example .env   # then re-enter nix develop, or `set -a; source .env; set +a`
just dev-up
```

## 2. Load the runtime env

```bash
source .claude/runtime/env.sh
```

Exports `OMNIBUS_PORT` and `PLAYWRIGHT_BASE_URL`. **Never hardcode the port** — your worktree's window base (3000 for the main checkout, hash-derived in 3010..3900 for any other worktree; see `flake.nix`) is only the *start* of the walk, and the server may have landed further up if a foreign process or a sibling worktree held it.

## 3. Capture the current build id

```bash
BEFORE_BUILD=$(curl -s "http://127.0.0.1:$OMNIBUS_PORT/api/_health" | jq -r .build_id)
```

This is the process-start timestamp, so it changes exactly when the server restarts — the signal that a `just dev-bounce` actually landed.

## 4. Open the page and log in

Use Claude Preview (`mcp__Claude_Preview__preview_*`). Always drive the login form, against a remote host too: never read a session cookie or token into a command's output and inject it into the browser, because the value then sits in the transcript as a live credential.

1. `mcp__Claude_Preview__preview_start` → `http://localhost:$OMNIBUS_PORT/login`
2. `mcp__Claude_Preview__preview_fill` username `admin` / password `omnibus-dev` (matches `.env.example`)
3. `mcp__Claude_Preview__preview_click` the Sign in button
4. `mcp__Claude_Preview__preview_snapshot` to confirm the redirect to the landing page

Cache this state for the rest of the session. Only redo the login if a later snapshot shows the login form again (cookie expired or got cleared).

## 5. Edit code, then pick up the change

- **React client change** (`frontend-js/`): re-run `just dev-up` — it rebuilds `frontend-js/dist` when stale and the running server serves the new files — then reload via `mcp__Claude_Preview__preview_eval` with `location.reload()`. For a tight loop, `just react` serves the client from source with hot reload on the port in `.claude/runtime/react-port`, proxying `/api` to this server; log in there separately.
- **Rust change:** `just dev-bounce`, then poll until `build_id` moves before reloading:

```bash
for i in $(seq 1 120); do
  NOW_BUILD=$(curl -s "http://127.0.0.1:$OMNIBUS_PORT/api/_health" | jq -r .build_id)
  [ "$NOW_BUILD" != "$BEFORE_BUILD" ] && break
  sleep 1
done
BEFORE_BUILD="$NOW_BUILD"
```

## 6. Verify against the flow doc

Find the flow doc for the feature you changed in [`docs/qa/agentic_exploration/flows/`](../../../docs/qa/agentic_exploration/flows/README.md), drive its **Steps**, and check the result against its **Pass** section. Read its **Sharp edges** first; they list the traps that waste a run. The docs are written for the exploration swarm, so on your own server:

- Skip the **Journal** section and anything about `journal.py` or explorer accounts. You are the seeded admin.
- Keep the ownership rule for destructive steps: delete or merge only books you uploaded for this check, on both sides of a merge, and never delete one whose upload attached to an existing book. `dev-up` may reuse a server whose library is real.
- Drive only the web steps. iOS and Kobo steps belong to the exploration lanes.
- A precondition your dev library can't meet (no audiobook, no CBZ) makes that step unverified, not passed. Say so.
- When no flow covers the change (see [Not covered](../../../docs/qa/agentic_exploration/flows/README.md#not-covered-and-why)), check the behaviour the change is meant to have, and say there was no flow.

What counts as proof:

- The action and the resulting state, not only the final screen.
- Side effects confirmed by a second read: reload the page, or `preview_eval` a `fetch` of the matching `/api/` route. A success toast alone proves nothing.
- A step you couldn't reach is reported as unverified, never as passed through a different path.

The tools:

- `mcp__Claude_Preview__preview_snapshot` — content/structure assertion (DOM tree).
- `mcp__Claude_Preview__preview_screenshot` — visual proof to share with the user.
- `mcp__Claude_Preview__preview_console_logs` — JS error checks.
- `mcp__Claude_Preview__preview_network` — failed-fetch checks.
- `mcp__Claude_Preview__preview_eval` — CSS / computed-style checks, e.g. `getComputedStyle(document.querySelector('.foo')).color`.

## 7. Run Playwright against the same server

```bash
source .claude/runtime/env.sh   # if not already sourced
cd ui_tests/playwright && pnpm exec playwright test
```

`PLAYWRIGHT_BASE_URL` makes the suite hit the walked-up port — both `baseURL` and the `Origin` header are derived from it, so the CSRF `origin_check` middleware stays happy.

That is for iterating. The dev DB accumulates state between runs, so a red here is not proof: confirm it with `just e2e-ci <spec>`, which runs the spec as CI does — its own server build and scratch DB (see [04-playwright](../../rules/04-playwright.md#running-specs--just-e2e-ci)).

## Common pitfalls

- **Snapshot shows the login form.** Cookie expired or cleared. Repeat step 4. The client sends a signed-out load of any page to `/login?next=<that page>`, so logging in from there lands back on the page rather than the library.
- **A URL the server builds shows the Vite port** (a KOReader plugin's server URL, a Kobo endpoint) when you're on `just react`'s server: its proxy keeps the browser's `Host`, so URLs built from the request carry that port. Expected, not a bug; on `$OMNIBUS_PORT` they carry the server's.
- **Checking data from a script.** `POST /api/auth/login` with `{"username","password","client_kind":"bearer"}` answers a `token` to send as `Authorization: Bearer` on `/api/*`.
- **`build_id` never changes after an edit.** Nothing restarted the server: a Rust change needs `just dev-bounce`; a client change needs none (re-run `just dev-up`, then reload).
- **The page doesn't show a client change.** `frontend-js/dist` is stale: re-run `just dev-up`; a failed client build stops it there, with Vite's error on its stderr.
- **`dev-up` exits 1 with "ports … all held by non-omnibus processes."** Run `lsof -iTCP:$PORT-$((PORT+9)) -sTCP:LISTEN -P` to see what's holding them. Most likely cause: a previous server you forgot about — `cat .claude/runtime/server.pid` and `just dev-down` (identity-checked), or pick a different starting `PORT`.
- **`dev-up` exits 1 after "did not become healthy" or a compile error.** `cargo run` failed or the server crashed at boot. Read `.claude/runtime/server.log`, fix it, then `just dev-up` again. `just dev-status` exiting 2 means a recorded server is alive but not answering: `just dev-bounce`.
- **You see `port N held by sibling workspace ...` on stderr.** Expected when another worktree's omnibus server is bound to your starting port. `dev-up` walks past it; nothing to fix.
- **Playwright hits the wrong server (seed 403s / unknown routes) when run through `scripts/with-dev-env.sh`.** The wrapper re-runs the shellHook, which resets `PLAYWRIGHT_BASE_URL` exported by your outer shell — the suite then falls back to `:3000`, which may be a *sibling workspace's* server. Source the runtime env **inside** the wrapped command: `./scripts/with-dev-env.sh e2e bash -ec 'source .claude/runtime/env.sh && cd ui_tests/playwright && pnpm exec playwright test'`.
- **Blank/black screenshots while the pane is hidden.** `document.hidden: true` means the Browser pane isn't fronted; the compositor paints nothing below the fold. Front the tab (or verify via DOM/`preview_eval` instead) — the app itself is fine.
