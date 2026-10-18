---
name: add-playwright-flow
description: Recipe for adding a new Playwright E2E spec under ui_tests/playwright/tests/flows/. Triggers when the user asks to add an E2E test, add a Playwright spec, or cover a new UI flow end-to-end.
---

# Add a Playwright flow

Full conventions live in [04-playwright.md](../../rules/04-playwright.md). This is the shortened recipe.

## 1. Create the spec file

One file per user flow: `ui_tests/playwright/tests/flows/<flow-name>.spec.ts`.
(Testing the iOS reader's glue rather than a web flow? That is
`tests/ios_glue/` and its own recipe — see
[04b-playwright-ios-glue.md](../../rules/04b-playwright-ios-glue.md).)

Specs use page objects; see
[04d-playwright-page-objects.md](../../rules/04d-playwright-page-objects.md) for
the layout and rules, and the `tests/flows/check_in_*.spec.ts` specs for worked
examples. Import `test` and `expect` from a fixtures file, never from
`@playwright/test`:

```ts
import { scan } from "../contracts/scan";
import { expect, test } from "../fixtures/pageFixtures";
```

## 2. Add the page objects the flow needs

Extend an existing page or component before adding one. A section of a page is
a component the page holds: `LibrarySectionComponent` is `adminPage.library`,
built in `AdminPage`'s constructor. A new page extends `BasePage`, sets
`urlPattern` and `readyLocator`, opens through `openAndSettle(path)` and gets a
fixture in `fixtures/pageFixtures.ts`.

```ts
// components/LibrarySectionComponent.ts
export class LibrarySectionComponent extends BaseComponent {
  readonly saveButton: Locator;
  readonly status: Locator;

  constructor(page: Page) {
    super(page);
    this.saveButton = page.getByRole("button", {
      name: "Save library settings",
    });
    this.status = page.getByTestId("settings-status");
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }

  async assertSaved(): Promise<void> {
    await expect(this.status).toHaveText("Library settings saved.");
  }
}

// pages/AdminPage.ts, in the constructor
this.library = new LibrarySectionComponent(page);
```

## 3. Write the layout test

One per spec, first in the file, with no user actions: open the page, then
check its URL, the shared nav and the page's key elements.

```ts
test("show the library sources layout", async ({ adminPage }) => {
  await test.step("open the library sources", async () => {
    await adminPage.goto("sources");
  });

  await test.step("check the page and its nav", async () => {
    await adminPage.assertDisplayedFor("sources");
    await adminPage.topNav.assertDisplayed();
    await expect(adminPage.library.saveButton).toBeVisible();
  });
});
```

## 4. Write one test per user action

Happy path and error path each get their own test, and each phase is a
`test.step`:

```ts
test.describe("library sources", () => {
  test("save the library paths", async ({
    adminPage,
    expectMutation,
    scratchLibrary,
  }) => {
    await test.step("open the library sources", async () => {
      await adminPage.goto("sources");
    });

    await test.step("save the form", async () => {
      await adminPage.library.fillForm(scratchLibrary);
      await expectMutation(settings.saveLibrary(scratchLibrary), () =>
        adminPage.library.save(),
      );
      await adminPage.library.assertSaved();
    });
  });
});
```

**Error path:** before the action, pass the contract to
`forceServerError(contract)`, which every page object inherits from
`BasePage`. Keep the `expectMutation`, and wrap its contract in `failing(…)`
from `utils/api.ts` so the test still proves the request fires and gets a 500.
Then assert the UI shows the error.

```ts
await checkInPage.forceServerError(scan.search(query));
await expectMutation(failing(scan.search(query)), () =>
  flow.searchByTitle(query),
);
await expect(flow.errorMessage).toBeVisible();
```

## 5. Selector preference order

1. `getByRole` — buttons, headings, links, form landmarks, live regions.
2. `getByText` — visible text not tied to a role.
3. `getByLabel` — form inputs. Add the label in SSR markup if missing.
4. `getByTestId` — only when nothing else fits. Add `data-testid` alongside `id` in the Dioxus rsx.
5. `locator` — last resort. Never XPath.

## 6. Where everything else goes

A spec holds tests and nothing else — no helper functions. Biome enforces the
locator half: see [04d](../../rules/04d-playwright-page-objects.md#lint).

| You need | Put it in |
|---|---|
| a locator or a UI action | the page or component object |
| a read of rendered content (an iframe, geometry) or a `page.on` listener | a page or component query or `record*` method |
| an API call to seed, clean up or read back | an `apiRequests/` class, injected from `fixtures/requestFixtures.ts` |
| a mutation's method, URL, body and status | a `contracts/` builder |
| a payload type or a unique test value | `data/` |
| data that must be deleted after the test | a fixture that cleans up after `use` (`cleanupSet` in `fixtures/lifecycle.ts`), in `fixtures/dataFixtures.ts`, or `fixtures/accountFixtures.ts` for account state |

## 7. Run

```bash
just dev-up                            # idempotent, identity-checked, fast on reuse
source .claude/runtime/env.sh          # picks up PLAYWRIGHT_BASE_URL for the chosen port
cd ui_tests/playwright
pnpm exec playwright test              # pnpm, not npm/npx
```

Before pushing, lint + typecheck the TS: `just lint-ts` (Biome check + `tsc --noEmit`), or `pnpm run lint` / `pnpm run typecheck` from `ui_tests/playwright`.

If you need to drive the same page manually (for snapshots / debugging while iterating on the spec), use the [`ui-validate`](../ui-validate/SKILL.md) skill — same server, same login, Claude Preview (`mcp__Claude_Preview__preview_*`) by default.

## 8. End-of-session

Run [99-end-of-session.md](../../rules/99-end-of-session.md).
