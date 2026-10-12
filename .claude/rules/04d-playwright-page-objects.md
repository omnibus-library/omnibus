# 04d — Playwright page objects

Companion to [04-playwright.md](04-playwright.md), which owns the toolchain
and the general conventions. This file is how a spec is built: page,
component and request objects, injected by fixtures.

The suite is moving from functional helpers to page objects, one surface at a time (#2744). `tests/flows/check_in_wishlisted.spec.ts` is the worked example. **New specs use page objects**; an unmigrated spec keeps its helpers in `utils/` until its surface moves, and a change to one doesn't have to migrate it.

| Directory | Holds |
|---|---|
| `tests/pages/` | `<Name>Page.ts`, one class per page, extending `BasePage` |
| `tests/components/` | `<Name>Component.ts`, extending `BaseComponent`: widgets on several pages (top nav, check-in overlay) |
| `tests/apiRequests/` | `<Area>Requests.ts`, extending `BaseRequests`: the API calls a spec makes to seed, clean up or read back |
| `tests/contracts/` | named `expectMutation` contracts per endpoint family (`scan.checkIn(book)`) and the URL patterns behind them |
| `tests/data/` | API types and builders that mint values unique across workers |
| `tests/fixtures/` | `test.ts` (base) → `pageFixtures.ts` (pages, `expectMutation`) → role and area fixtures (`readerFixtures.ts`), beside the fixture-book tables |

- **Specs** import `test` and `expect` from a fixtures file, never `@playwright/test`. They never construct a page object or touch `page`: pages, requests and `expectMutation` arrive as fixtures.
- **Locators** are `readonly` fields assigned in the constructor and named for the element: `isbnField`, `checkInButton`, `physicalCopyCards`. One that takes an argument is a method: `galleryShelfTile(id)`.
- **Navigation:** a page's `goto()` calls `BasePage.open(path)`, which waits for hydration and then the page's `readyLocator`. `assertDisplayed()` checks the URL and that marker.
- **Actions** are verbs and never assert. One that fires a request starts `waitForResponse` before it clicks and awaits it; one whose response the test needs returns it parsed (`addToWishlist()` → `{ book_uuid }`). `assert*` methods are only for grouped checks several specs would repeat.
- **Stubs** (`page.route`) live in page-object methods (`stubIsbnLookup`), and only force a state the server can't produce on demand: an answer from the metadata providers behind `scan/resolve`, or a forced error.
- **Mutations** go through the `expectMutation` fixture, already bound to the page, with a named contract from `tests/contracts/`: `await expectMutation(scan.checkIn(wish), () => overlay.checkInCopy())`.
- **Fixtures** construct objects but never navigate. One that creates data deletes it after `use` (`createdBookUuids`), so cleanup runs when a test fails.
- **Specs** read as `test.describe("<subject>")` → imperative lowercase titles (`check in a wishlisted book from its own page`) → one `test.step` per phase. Hooks are titled: `test.beforeAll("seed the library", …)`.

## Accounts — one per worker, never per test

Sign-in (`/api/auth/login`, `register`, `logout`) allows ten calls a minute per
IP, and `globalSetup` spends three. A spec that runs as someone other than the
suite's admin takes a worker-scoped account (`readerAccount` in
`readerFixtures.ts`): created once per worker, signed in once for its cookie
and once for its bearer token, and deleted when the worker ends. The fixture
overrides `storageState`, so the test's own `page` is already that user's.
Because tests share the account, each must delete the data it made.
