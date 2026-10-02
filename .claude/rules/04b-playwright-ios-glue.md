# 04b — The iOS reader glue harness

Companion to [04-playwright.md](04-playwright.md). `omnibus-ios/omnibus/Reader/Web/`
— `reader.html`, epub.js and the iOS copy of `epub-reader-glue.js` — is the
native app's reader, and nothing the web app serves. Its only test lane is
`ui_tests/playwright/tests/ios_glue/`, which runs it in the suite's Chromium:
XCUITest cannot see inside the web view, and the iOS unit suite has no DOM.

## How a spec reaches it

- **Serve the files off disk on a routed origin.** `page.route` on
  `http://ios-glue.test/**` fulfils `reader.html` and its three scripts from
  `omnibus-ios/omnibus/Reader/Web/`, unchanged, plus a book. Never copy them
  next to the spec — a copy only tests itself.
- **Build the book in memory** with JSZip, shaped to the case. The
  public-domain fixtures are clean Gutenberg markup, which is exactly why they
  never caught #2650: hidden page-break markers, in-body stylesheets and
  `[hidden]` blocks are what commercial and Calibre-converted books carry.
- **Replace the host callbacks before `init`.** `reader.html` bridges every
  `__omnibusOn*` callback to a WKWebView message handler that is not there (its
  `send` swallows the error); overwrite the ones a spec reads with ones that
  record the payload on `window`.
- **Drive the entry points the Swift host calls**, in host-window
  coordinates — `OmnibusReader.init`, `beginSelectionAt`, `extendSelectionTo`,
  `endSelectionDrag`, the same calls `ReaderWebView.swift` evaluates. Never
  reach into the glue's closure: a test-only export on `OmnibusReader` is API
  the app ships.
- **Wait on what the glue reports** — `expect.poll` on the recorded status
  until `"ready"` — never on a timeout. The one exception is asserting an
  absence (no relocate reported movement), which needs a window.

`tests/utils/ios_glue.ts` is that harness — `buildChapterEpub` (further spine
items via `chapters`, for anything that crosses a chapter), `openGlue` and the
recorders — so a spec supplies only its chapters and its drive.

The one-layout-test rule in 04 is for `tests/flows/`; a glue spec has no page
of its own to lay out. It needs no server, but it runs under the suite's
`globalSetup` like every other spec.

## What it does not prove

It is Chromium, not WebKit. It pins the glue's DOM logic — which text nodes a
walk keeps, what range a token covers, what a payload carries — and nothing
WebKit does differently: touch dispatch, WKWebView's own text interaction
(#2655), `-webkit-` rendering.

## CI

`e2e.yml`'s `changes` filter includes `omnibus-ios/omnibus/Reader/Web/**`, so a
glue-only PR still runs this lane. That path is deliberately **not** in the
bundle cache key: the web bundle never reads it, so such a PR reuses the cached
bundle.
