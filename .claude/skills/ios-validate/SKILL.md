---
name: ios-validate
description: Screenshot tours of the native iOS app (omnibus-ios/) on a simulator of this worktree's own, against a scratch server. Triggers when you need to see an iOS change on screen, show the user pictures of one, or check a screen a unit test can't reach — including while another worktree is using a simulator.
---

# Validate an iOS change on the simulator

A **tour** is a scratch XCUITest that signs in to a scratch server, opens each screen by deep link and saves a screenshot of it. Everything it touches is this worktree's own — the simulator (`omnibus-tests-<worktree>`), a port in this worktree's window, and `.claude/runtime/ios-validate/` — so two worktrees can tour at once. Each booted simulator costs 1–2 GB of RAM.

## 1. Start the scratch server

```bash
scripts/ios-validate.sh server up
```

It builds this worktree's server (minutes on a first build; sccache shares the dependencies), starts it on an empty database, indexes the fixture library and seeds the account `tour` / `omnibus-tour-2026`. Done when it prints `scratch server: http://127.0.0.1:<port>`.

- **iOS-only change:** skip the build with `OMNIBUS_IOS_SERVER_BIN=<a built server>`, e.g. `~/.cache/cargo-target/omnibus/debug/omnibus`.
- **Fixtures missing:** `just fixtures`.

## 2. Seed what the screens need

The fixture library has series (Code Quartet ×4, Pioneers ×5, Compiler Compendium ×3, Aurora Station ×2) and standalone books, but no shelves, reading state or non-default settings. Create those over REST:

```bash
source .claude/runtime/ios-validate/env.sh
api() { local route="$1"; shift; curl -sf -H "authorization: Bearer $OMNIBUS_TOUR_TOKEN" -H 'content-type: application/json' "http://$OMNIBUS_TOUR_SERVER$route" "$@"; }
api /api/shelves -X POST -d '{"kind":"manual","name":"Weekend reads"}'   # answers {"id": …}
api /api/shelves/<id>/books -X POST -d '{"book_uuids":["…"]}'
sqlite3 .claude/runtime/ios-validate/server/omnibus.db "select id, uuid, title from books"   # uuids aren't in GET /api/ebooks
```

Done when every screen the tour will show has the data it needs.

## 3. Write the tour

```bash
cp .claude/skills/ios-validate/screen-tour.swift omnibus-ios/omnibusUITests/ScreenTour.swift
```

`ScreenTour*.swift` is gitignored, so the tour can't be committed. Replace the blocks in `testTour` with one per screen: `open(<route>)`, wait for an element that proves the screen drew, `shot(<name>)`.

A route is `<tab>/<screen>/<screen>…`, opened as `omnibus://debug/screen/<route>` (DEBUG builds only). The tab is `library`, `search`, `stats` or `you`; each screen after it is pushed in order: `shelves`, `shelf/<id>`, `authors`, `author/<id>`, `series`, `series/<id>`, `tags`, `tag/<name>`, `genres`, `genre/<name>`, `book/<uuid>`, `edit/<uuid>`, `results/<query>`, `settings`, `goals`, `downloads`. `App/DebugScreenLink.swift` is the parser.

- **State the tour writes stays written.** A setting it flips is still flipped on the next run; start over with `server up --fresh` (about 30 s), then seed again.
- **Lazy grids** build only the cells near the viewport: `scrollTo(element)` before asserting on or shooting anything below the fold.

## 4. Run it

```bash
scripts/ios-validate.sh tour ScreenTour
```

It uninstalls the app so the run starts from a clean container, runs only `ScreenTour` on this worktree's simulator (created and booted on first use), and lists the PNGs in `.claude/runtime/ios-validate/shots/`. Read every shot: the tour is done when each one shows the screen it names, since a passing test can still photograph the wrong screen. A failed assertion's message is only in the result bundle: `xcrun xcresulttool get test-results tests --path .claude/runtime/ios-validate/results/ui-ScreenTour.xcresult`. Each edit-and-rerun cycle takes 2–3 minutes.

## 5. Hand over and clean up

- Give the user the shots: attach them where the session can, otherwise their paths.
- Delete `omnibus-ios/omnibusUITests/ScreenTour.swift`, then `scripts/ios-validate.sh server down`.
- The simulator stays for the next tour. Before removing the worktree, `scripts/ios-validate.sh cleanup` stops the server and deletes the simulator. A user-level worktrunk hook can run it for every `wt remove`:

  ```toml
  # ~/.config/worktrunk/config.toml
  [projects."github.com/omnibus-library/omnibus"]
  pre-remove = "scripts/ios-validate.sh cleanup || true"
  ```

  It belongs in user config, not the repo's `.config/wt.toml`: a project hook needs approval, and an unapproved one aborts a non-interactive `wt remove` while still exiting 0.
