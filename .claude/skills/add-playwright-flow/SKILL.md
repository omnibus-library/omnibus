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

New specs use page objects; see
[04d-playwright-page-objects.md](../../rules/04d-playwright-page-objects.md) for
the layout and rules, and the `tests/flows/check_in_*.spec.ts` specs for worked
examples. Import `test`
and `expect` from a fixtures file, never from `@playwright/test`:

```ts
import { scan } from "../contracts/scan";
import { expect, test } from "../fixtures/pageFixtures";
```

## 2. Add the page objects the flow needs

Extend an existing page or component before adding one. `/settings` is the
one `SettingsPage`, so a flow on its library paths form adds members to that
class and reaches the form with `goto("library")`:

```ts
export class SettingsPage extends BasePage {
  // …the members it already has

  readonly saveLibraryButton: Locator;
  readonly libraryStatus: Locator;

  constructor(page: Page) {
    // …
    this.saveLibraryButton = page.getByRole("button", { name: "Save" });
    this.libraryStatus = page.getByTestId("settings-status");
  }

  async goto(section: "account" | "library"): Promise<void> {
    await this.openAndSettle(`/settings?section=${section}`);
  }

  async saveLibrary(): Promise<void> {
    const saved = this.page.waitForResponse(isPostTo(/\/api\/rpc\/settings$/));
    await this.saveLibraryButton.click();
    await saved;
  }
}
```

A page with no object yet extends `BasePage`, and its fixture goes in
`fixtures/pageFixtures.ts`.

## 3. Write the layout test

One per spec, first in the file, with no user actions: open the page, then
check its URL, the shared nav and the page's key elements.

```ts
test("show the library settings layout", async ({ settingsPage }) => {
  await test.step("open the library section", async () => {
    await settingsPage.goto("library");
  });

  await test.step("check the page and its nav", async () => {
    await settingsPage.assertDisplayed();
    await settingsPage.topNav.assertDisplayed();
    await expect(settingsPage.saveLibraryButton).toBeVisible();
  });
});
```

## 4. Write one test per user action

Happy path and error path each get their own test, and each phase is a
`test.step`:

```ts
test.describe("library settings", () => {
  test("save the library paths", async ({ settingsPage, expectMutation }) => {
    await test.step("open the library section", async () => {
      await settingsPage.goto("library");
    });

    await test.step("save the form", async () => {
      await expectMutation(settings.save(paths), () =>
        settingsPage.saveLibrary(),
      );
      await expect(settingsPage.libraryStatus).toHaveText("Settings saved.");
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
locator half: see [04d](../../rules/04d-playwright-page-objects.md#lint). When
migrating an existing spec, delete its `!` line from `biome.json`'s `overrides`.

| You need | Put it in |
|---|---|
| a locator or a UI action | the page or component object |
| a read of rendered content (an iframe, geometry) or a `page.on` listener | a page or component query or `record*` method |
| an API call to seed, clean up or read back | an `apiRequests/` class |
| a mutation's method, URL, body and status | a `contracts/` builder |
| a payload type or a unique test value | `data/` |
| data that must be deleted after the test | a fixture that cleans up after `use` |

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
