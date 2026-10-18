---
paths: "ui_tests/**"
---
# 04d — Playwright page objects

Companion to [04-playwright.md](04-playwright.md), which owns the toolchain
and the general conventions. This file is how a spec is built: page,
component and request objects, injected by fixtures.

Every spec is built this way. The `tests/flows/check_in_*.spec.ts` specs are the worked examples: `check_in_wishlisted` for a reader's own data, `check_in_choose` for admin writes the test cleans up, `reader.spec.ts` for an iframe, `evaluate` probes and listeners.

| Directory | Holds |
|---|---|
| `tests/pages/` | `<Name>Page.ts`, one class per page, extending `BasePage`, or a shared abstract base when pages draw the same chrome (`PagedReaderPage`, `SettingsShellPage`) |
| `tests/components/` | `<Name>Component.ts`, extending `BaseComponent`: widgets on several pages (top nav, the check-in flow and its overlay) |
| `tests/apiRequests/` | `<Area>Requests.ts`, extending `BaseRequests`: the API calls a spec makes to seed, clean up or read back |
| `tests/contracts/` | named `expectMutation` contracts per endpoint family (`scan.checkIn(book)`) and the URL patterns behind them |
| `tests/data/` | API types and builders that mint values unique across workers |
| `tests/fixtures/` | `test.extend` layers, each importing the one before it: `test.ts`, `requestFixtures.ts`, `accountFixtures.ts`, `dataFixtures.ts`, `pageFixtures.ts` (what specs import), `readerFixtures.ts` (the page signed in as the reader); the fixture-book tables sit beside them |

- **Specs** import `test` and `expect` from a fixtures file, never `@playwright/test`. They never construct a page object or touch `page`: pages, requests and `expectMutation` arrive as fixtures.
- **Locators** are `readonly` fields assigned in the constructor and named for the element: `isbnField`, `checkInButton`, `cards`. One that takes an argument is a method: `galleryShelfTile(id)`.
- **Navigation:** a page's `goto()` usually calls `BasePage.openAndSettle(path)`: it waits for hydration, the page's `readyLocator`, then network idle (`CheckInPage.goto` stops at `open`). A page a spec holds a request on never idles, so it has a `gotoUnsettled()` that calls `open(path)` and stops before the idle. `assertDisplayed()` checks the URL and that marker.
- **Actions** are verbs, never assert and return nothing. A `hold*` action is the exception: it parks requests through `holdRequests` in `utils/api.ts` and returns the release the test awaits. One that fires a request starts `waitForResponse` before it clicks and awaits it. An action whose save depends on the page moving (a page turn, a contents jump) only clicks; a test that asserts the save wraps it in `expectMutation`. A test that needs the body reads it from the `response` that `expectMutation` returns, so the same action also runs the forced-failure path. `assert*` methods are only for grouped checks several specs would repeat.
- **Stubs** (`page.route`) live in page-object methods (`stubIsbnLookup`, and `forceServerError` on `BasePage`), and only force a state the server can't produce on demand: an answer from the metadata providers, a forced error, or a write to a fixture other specs read (`stubCheckIn`).
- **Frames and probes:** a same-origin iframe is a component holding `locator(…).contentFrame()`; a `page.evaluate` read is a query method returning a value the spec polls; a `page.on` listener is a `record*()` method returning a live list.
- **Mutations** go through the `expectMutation` fixture, already bound to the page, with a named contract from `tests/contracts/`: `await expectMutation(scan.checkIn(wish), () => overlay.checkInCopy())`. Against a forced error, wrap the contract: `failing(scan.checkIn(wish))`.
- **Fixtures** construct objects but never navigate. One that creates data deletes it after `use` (`createdBookUuids`), so cleanup runs when a test fails. `fixtures/lifecycle.ts` holds the two shapes: `cleanupSet` for a set the test fills, `presetting` for a setter that puts `reset` back on each owner it wrote to. A test that deletes the data itself takes it off the list (`createdBookUuids.delete(uuid)`).
- **Specs** read as `test.describe("<subject>")` → imperative lowercase titles (`check in a wishlisted book from its own page`) → one `test.step` per phase. Hooks are titled: `test.beforeAll("seed the library", …)`.

## Lint

`biome check .` (in `just lint-ts` and CI) runs two GritQL plugins from `ui_tests/playwright/lint/`:

- `awaitWebFirstAssertions.grit`, on every file: a web-first assertion (`expect(locator).toBeVisible()`) must be awaited, or it can never fail the test. This is what keeps `assert*` methods honest.
- `specsUsePageObjects.grit`, on specs: no `getBy*`, `locator`, `route`, `first`, `last` or `nth` call. Those belong to a page or component object, which picks an item by what it shows (`searchResultButton(title)`), never by position.

`biome.json` applies the second plugin to every `tests/**/*.spec.ts`, so a raw selector or route in a spec fails CI; there is no allowlist.

## Accounts — one per worker, never per test

Sign-in (`/api/auth/login`, `register`, `logout`) allows ten calls a minute per
IP, and `globalSetup` spends three. A spec that runs as someone other than the
suite's admin takes a worker-scoped account (`readerAccount` in
`accountFixtures.ts`): created once per worker, signed in once for its cookie
and once for its bearer token, and deleted when the worker ends.
`readerFixtures.ts` overrides `storageState`, so the test's own `page` is
already that user's. A spec whose page stays the admin's reaches the reader
through `readerPage` and the page objects built on it (`readerLibraryPage`,
`readerBookDetailPage`, `readerSettingsPage`, `readerAdminPage`, `readerShelfPage`), each in a
browser context signed in as them; `readerExpectMutation` is bound to that page
and `readerRequest` makes the API calls. A household needs a second reader:
`secondReaderAccount`, `secondReaderPage` and `secondReaderExpectMutation`.
Because tests share the accounts, every fixture that changes one resets it on
teardown (`presetStackSeries`, `presetScrollStops`).
