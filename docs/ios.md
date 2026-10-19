# iOS app

Native SwiftUI client, and the iOS surface going forward — an Xcode project
(`omnibus-ios/omnibus.xcodeproj`), **not** a Cargo crate, so it is invisible to
`cargo build` / `just lint` / `just test`. It consumes the same `/api/*` REST
surface as `mobile/`, never the `/api/rpc/*` server functions.

Each Swift file opens with a header comment saying what it is for; print the
file map from those headers with `just modules omnibus-ios/omnibus`. This page
covers what no single file can: the second target, the release pipeline, and
the reader's design.

## Widgets

Two more directories sit beside `omnibus/` rather than inside it, because they
are the other half of a second target:

```
OmnibusShared/      — source compiled into *both* the app and the widget
                      extension (a filesystem-synchronized group listed in two
                      targets' `fileSystemSynchronizedGroups`): WidgetSnapshot
                      (the wire form, plus the cursor arithmetic the medium
                      card flips its rail with), WidgetStore (the App Group
                      container's layout, the only encoder either side uses,
                      and where that cursor is kept), DeepLink
                      (the `omnibus://book/<uuid>` URLs the widget mints and
                      the app parses back) and OKLCH (the OKLCH↔sRGB
                      conversion for server-provided accents — shared so the
                      widget and the Continue hero cannot draw one book in two
                      different colours)
OmnibusWidgets/     — the WidgetKit extension (`com.omnibus.mobile.widgets`,
                      embedded into the app at `PlugIns/`): ContinueWidget (a
                      `TimelineProvider` that reads the App Group and nothing
                      else, so it renders in Airplane Mode with the app force
                      quit), its three family layouts and the three distinct
                      empty states, ContinueIntents (a widget cannot be swiped,
                      so the medium card shows one book and carries an
                      `AppIntent` that flips to the next — capped at three,
                      and absent from the small card, which answers with
                      whichever book you touched last and nothing else), and
                      WidgetTheme — colours derived entirely from the book's
                      own tone, because the reader's chosen
                      theme lives in the app's `UserDefaults`, which the
                      extension cannot read
```

Both processes address `group.com.omnibus.mobile`, declared in
`omnibus-ios/omnibus.entitlements` and `omnibus-ios/OmnibusWidgets.entitlements`
and named once in code as `WidgetStore.appGroupID`. All three must agree: a
mismatch is silent — the container URL comes back `nil` and every widget falls
back to its placeholder. The app writes the snapshot at each of the four moments
the Home Screen could have gone wrong (`LifecycleSync`'s foreground, background,
background-refresh and book-close hooks), plus on every `bootstrap` exit path —
including the ones that end at the connect or login screen, since a widget
outlives a sign-out and would otherwise keep showing the previous account's
books.

## Release

**TestFlight release requires a second provisioning profile.** A profile is
bound to one bundle ID and the app now embeds `com.omnibus.mobile.widgets`,
so `IOS_WIDGETS_PROVISIONING_PROFILE_BASE64` sits alongside
`IOS_PROVISIONING_PROFILE_BASE64` and `ExportOptions.plist` carries a
`provisioningProfiles` entry per embedded bundle. Both App IDs must also carry
the App Groups capability for `group.com.omnibus.mobile` — which means the
*existing* app profile has to be regenerated, not just the new one created: a
profile does not pick up a capability added after it was created.

Getting that wrong fails **silently**, so it is checked from both ends. A
provisioning profile only *permits* an entitlement — the binary has to claim it,
which happens when the target's `.entitlements` is applied at signing time. The
release archive is therefore signed (manual signing, set per-target on the
**Release** configuration and scoped to `iphoneos` so simulator builds need no
distribution credentials); an unsigned archive carries no entitlements at all and
`-exportArchive` re-signs it with only the baseline four, which is how a correct
profile still yields a widget that renders nothing.
`.github/actions/ios-signing/check-profile.sh` asserts each profile's app id, App
Group and distribution type *before* the archive, and the export step re-reads
the signed IPA to confirm the entitlement actually landed. Simulator lanes prove
none of it — they sign ad-hoc.

**TestFlight release:** the manually-triggered
`.github/workflows/testflight.yml` (workflow_dispatch, `macos-26` runner —
Xcode 26 / iOS 26 SDK, which App Store Connect now requires) archives the
Xcode project with manual signing (`xcodebuild archive` +
`-exportArchive`, bundle `com.omnibus.mobile`) and uploads the `.ipa`
with `xcrun altool`, stamping the marketing version from the latest `v*`
release tag so TestFlight tracks the server release. Signing is seven
CI-only repo secrets (distribution cert + password, an App Store
provisioning profile for *each* of the two embedded bundles, App Store
Connect API key + key-id + issuer-id) — enumerated in the
workflow file's header comment.

A third job then **distributes** the build, because uploading it does not:
`altool` delivers the binary and stops, an internal group can be set to
distribute automatically but an external group cannot, and a build nobody adds
to one is invisible to every tester on the public link while the run still
reports success. `scripts/testflight_distribute.py` waits out processing,
submits for Beta App Review when the build still needs it (the first build of a
marketing version does), sets "What to Test" from the required `whats_new`
dispatch input, and adds the build to
each group named by the job's `BETA_GROUPS`. It runs on ubuntu — it is pure App
Store Connect API — reuses the same team-scoped API key, and is idempotent, so a
re-run attaches nothing twice. Because that script only ever executes during a
release dispatch against Apple's live API, its suite
(`scripts/tests/testflight-distribute.test.py`, HTTP stubbed, no credentials) is
gated in CI by `script-tests.yml`. Those stubs encode Apple's contract as it
was last observed, and cannot notice it changing: `GET /v1/builds/{id}/betaGroups`
answered for months before App Store Connect began enforcing that relationship
as write-only and returning `FORBIDDEN_ERROR`, and the suite went on passing
against the stub while every real dispatch failed short of attaching anything. Membership is therefore read from
the builds side (`filter[id]` + `filter[betaGroups]`), and a live dispatch stays
the only place the contract is genuinely exercised. A daily companion workflow
(`testflight-feedback.yml`) turns new TestFlight screenshot feedback into
GitHub issues via `scripts/testflight_feedback_to_issues.py`. Its dedupe is one
listing of the `testflight`-labelled issues (open and closed) whose bodies carry
the `asc-feedback-id` marker, not a Search API call per submission: search is
capped at ~30 requests a minute, and once the backlog passed that the tail of
every run 403'd and — because the check then *proceeded* — refiled the same
submissions daily. A listing that fails aborts the run instead. Its suite
(`scripts/tests/testflight-feedback.test.py`) is gated by the same
`script-tests.yml`.

## Reader

**Why the reader is a WebView.** iOS ships no EPUB renderer, and epub.js already
produces the CFI positions the server's `epub_cfi` / `epub_cfi_range` contract
expects — so replacing it would mean reimplementing pagination *and* CFI
generation compatibly. Assets and book bytes are served over a custom
`omnibus-reader://` scheme so epub.js sees one same-origin space and needs no
cookie. Everything around it — chrome, gestures, sheets, persistence — is
native.

**Comics skip the WebView entirely.** A CBZ is images, so `Comic/` pages them
natively (pinch zoom, paged `TabView`) against the server's per-page endpoint,
or against the downloaded archive via **ZIPFoundation** — the app's only Swift
package dependency, pinned in the project's `Package.resolved`. Positions ride
the same Epub-format progress row as every reader, as a `comic-page:N` anchor
plus the cross-surface percent (`omnibus_shared::comic_page_anchor`), and a
downloaded archive is CRC-verified before it replaces anything on disk.

**PDFs are native too, on PDFKit.** A PDF-only book (the last rung of the
shared EPUB > CBZ > PDF ladder, `Book.opensAsPDF`) opens in `Reader/PDF/`: a
`PDFView` in single-page mode behind a page view controller, so the platform
does paging, zoom and text selection. Positions ride the Epub-format progress
row as a `pdf-page:N` anchor plus the cross-surface percent, exactly as comics
do. Highlights are the web reader's `pdf:{page}:{quads}` anchors — quads in PDF
user space on the *unrotated* page, the frame `PDFSelection.bounds(for:)` and
PDF.js's rotation-0 viewport share — painted as `PDFAnnotation` highlights
whose `userName` carries the row's handle so a tap finds it again; bookmarks
are `pdf-page:N`. Offline, `/file` serves the PDF for a PDF-only book and the
download is checked structurally (header, `%%EOF`, a parse with pages) before
install — no CRC exists to check, per rule 09. Streaming opens fetch the whole
file into a validator-keyed cache and open it by URL, never from a `Data`.

**Selection is drawn by the app, not by WebKit.** WebKit's text interaction
is switched off for the whole reader web view (`isTextInteractionEnabled =
false` in `ReaderWebView.makeConfiguration`, #2655): a long press the glue
declines — above the first line, on an illustration — otherwise fell through
to WebKit, which selected the section iframe as one block and washed the whole
page. The host page and the glue's per-section baseline stylesheet also declare
`user-select: none`; both predate the switch and are kept as belt and braces,
but neither is what stops the recogniser. The glue runs its own engine instead:
`beginSelectionAt` / `extendSelectionTo` / `beginEdgeDrag` own the range and
report per-line rects in web-view coordinates, and
`Reader/ReaderSelectionLayer.swift` draws the tint, the handles, and the
`PassageAnchor` the menu hangs off. WebKit's selection is unusable here for two
reasons: its handles and loupe are laid out against a section iframe as wide as
the whole chapter, so in a paginated book they land in the wrong column, and its
long-press recogniser fights the glue's drag-to-turn handler for the same touch.
Three contracts follow the system text view's. The long press and the drag
that continues it move by the *word*; the handles that come up afterwards move
by the *character* (`sel.granularity`), so a comma can be left out and a word
split. A range may cross the page break: resting a finger or a handle in the
outer sliver of the stage past the text (`trackEdge` / `turnWithinSection`)
turns the page after a beat and runs the range on, and keeps turning while it
stays — within the section only, since a CFI range cannot span two documents,
and never for an RTL book, whose engines page with negative scroll offsets and
which the swipe handler likewise keeps on the classic at-release turn. The zone
arms only once the finger has travelled (`noteDragTravel`), because a selection
ending at the right margin puts its handle inside the zone already and a reader
who merely grabbed it would have the page turn out from under them.
The glue then reports only the rows on the page in front of the reader, with
each of `start` / `end` null while that end is on another page, and the held
handle stays in the SwiftUI tree offstage so its gesture survives the frame
its caret is gone. And every rect is measured off the *text* (`textRects`),
never `Range.getClientRects()`, which also returns the border box of any
element the range wholly contains — a middle paragraph, an image — and painted
a three-paragraph selection as a block over the second. The same walk is
patched into epub.js's marks (`patchMarkRects`), whose own filter kept that
block and dropped the text boxes inside it. Highlights stay epub.js marks (they
ride the page-turn transform, which a native overlay would not); their look is
one host-document rule, `markStyleCss`, which switches blend mode with the
reading theme.

**The glue is forked.** `omnibus-ios/omnibus/Reader/Web/epub-reader-glue.js` is a
copy of `frontend/assets/vendor/epub-reader-glue.js`, and the two have diverged:
the iOS copy carries `sectionRanges` / `pagesLeftInSection`, the host's
`minSpreadWidth` init option, plus the whole selection engine above, and the web
copy has since moved its pagination onto `location.start.displayed` and still
uses WebKit's own selection. Changing one does not change the other — check both
when touching reader behaviour. The
annotation repaint (`repaintAnnotations` / `scheduleAnnotationRepaint`, re-measuring
marks after a typography or webfont reflow that epub.js does not reframe for) was
one such gap: it existed on web only until #2193 ported it, and the iOS copy also
schedules it from the stage-resize watch, which the web copy does not. The
typeface layer — the `fontsHref` init option, `applyFontFamily`'s per-section
`__omnibus_font` override, and `inlineFontReplacements`' `data:` rewrite of
epub.js's resource table plus its `spine.hooks.serialize` gate — was added to
both copies by hand, which is the only way to add anything here.

**The page is booted more than once per book.** iOS reclaims the web-content
process of an app that has been in the background a while, and `reader.html` is
loaded again when the reader comes back — announcing `hostReady` a second time
and taking the stage's whole state with it. So nothing a boot reads may be a
snapshot of the open: `ReaderController.restoreCFI` tracks every relocate rather
than holding the CFI `configure` was given (booting the fresh page at the opening
position undid the session's reading, and the relocate that followed persisted
and pushed the revert), and the marks the outgoing page had painted go back on
the pending queue. `webViewWebContentProcessDidTerminate` makes the recovery
explicit, deferring the reload past a backgrounding rather than feeding a fresh
process to the same reclaim.

Typography is the third thing a boot carries, and it is shaped differently from
the other two: it *is* a snapshot, because `bootScript` has to hand the glue one
complete set of options in a single call. So the boot records what it handed over
in `ReaderController.appliedSettings`, and `ready` re-syncs the difference. Both
halves of the reboot window matter and each is carried by a different mechanism —
a change made before the replacement announces `hostReady` rides the boot options
(`bootScript` reads `settings` live), and one made after it announces but before
it paints rides the re-sync. Dropping the second left the settings sheet showing
one size while the page rendered another until the next reboot (#2191). A new
`ReaderSettings` field therefore has to be added in three places, not one:
`bootScript`'s options, `settingsScripts`' diff, and the tolerant decoder.

`appliedSettings` is `nil` whenever no page is holding our typography, and the
two page-death paths each clear only their own half of that — `prepareForReboot`
drops `isReady` and leaves the view, `teardown` drops the view and leaves
`isReady` — so the gate is `hasLivePage`, which asks both, never one alone.

## Models and offline

**The models are hand-mirrored, so they drift silently.** `Models/` restates the
`shared/` wire DTOs in Swift with no generator and no compiler tying the two
together, so a change on the Rust side surfaces only at runtime, never as a
build error: a request missing a field a handler now requires gets a 422, a
response field renamed or removed fails as `APIError.decoding`, and a new enum
variant can vanish into a `#[serde(other)]`-style fallback. `omnibusTests/ScanCodecTests.swift` is the pattern for pinning one of
these contracts — assert the encoded keys a handler requires, and that every
enum variant the server can answer with maps to its own case rather than the
catch-all. Worth adding wherever a mismatch would fail quietly.

**Simulated offline.** `Offline/DebugOffline.swift` is a DEBUG-only switch that
fails the whole `/api/*` client — and `AuthService.probe`, so nothing quietly
reconnects — with the same `APIError.offline` a real outage produces. It is
flipped by the `--uitest-offline` / `--uitest-online` launch arguments or an
`omnibus://debug/offline?on=…` URL, persisted so a relaunch keeps it, and read
back out of the app's own preferences plist by
[`scripts/explore/ios.sh`](../scripts/explore/ios.sh). It does **not** cover the
background download session. `scripts/ios-release-guard.sh` (`just
ios-release-guard`) asserts it and the other `--uitest-*` hooks are absent from
a Release build; the lane's contract is
[`docs/qa/agentic_exploration/ios_lane.md`](qa/agentic_exploration/ios_lane.md).

**Screen links.** `App/DebugScreenLink.swift` is a DEBUG-only
`omnibus://debug/screen/<tab>/<screen>…` link that selects a tab and pushes a
stack on it, so a scripted screenshot tour reaches any screen without tapping
its way there. `MainTabView` applies it once it is on screen, so a link that
arrives during launch waits. Tours run through
[`scripts/ios-validate.sh`](../scripts/ios-validate.sh) on a simulator of each
worktree's own; the recipe is the
[ios-validate skill](../.claude/skills/ios-validate/SKILL.md). The release guard
covers this hook too.

**Offline writes** follow [rule 08](../.claude/rules/08-offline-writes.md): the
`OpKind` outbox in `Offline/SyncEngine.swift` carries per-user content state
only, never configuration and never commands. `OutboxScope` in `Offline/Cache.swift`
declares each kind's blast radius, and `Offline/ReplicaInvalidations.swift` applies
the same declaration to mounted screens: each `SyncEngine.write` announces its kind,
and the Library home's rails re-read the keys it moves. `omnibusTests/OfflineSyncTests.swift` and
`omnibusTests/DebugOfflineTests.swift` cover them,
and `omnibusTests/ReaderSelectionTests.swift` pins the selection payload the glue
posts plus the passage-menu placement rules;
`omnibusTests/ReaderNativeSelectionTests.swift` pins the two guards that keep
WebKit's own selection off (#2655). CI runs the suite via
`ios-tests.yml` ([rule 01](../.claude/rules/01-dev-environment.md)); to run it
locally:

```bash
xcodebuild test -project omnibus-ios/omnibus.xcodeproj -scheme omnibus \
  -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:omnibusTests
```
