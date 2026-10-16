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
the layout and rules, and `tests/flows/check_in_wishlisted.spec.ts` for a worked
example. Import `test`
and `expect` from a fixtures file, never from `@playwright/test`:

```ts
import { scan } from "../contracts/scan";
import { expect, test } from "../fixtures/pageFixtures";
```

## 2. Add the page objects the flow needs

Extend an existing page or component before adding one. A new page extends
`BasePage`, and its fixture goes in `fixtures/pageFixtures.ts`:

```ts
export class SettingsPage extends BasePage {
  protected readonly urlPattern = /\/settings$/;

  readonly topNav: TopNavComponent;

  readonly saveButton: Locator;
  readonly statusMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.saveButton = page.getByRole("button", { name: "Save" });
    this.statusMessage = page.getByRole("status");
  }

  protected get readyLocator(): Locator {
    return this.saveButton;
  }

  async goto(): Promise<void> {
    await this.open("/settings");
  }

  async save(): Promise<void> {
    const saved = this.page.waitForResponse(isPostTo(/\/api\/rpc\/settings$/));
    await this.saveButton.click();
    await saved;
  }
}
```

## 3. Write the layout test

One per spec, first in the file, with no user actions: open the page, then
check its URL, the shared nav and the page's key elements.

```ts
test("show the settings page layout", async ({ settingsPage }) => {
  await test.step("open the settings page", async () => {
    await settingsPage.goto();
  });

  await test.step("check the page and its nav", async () => {
    await settingsPage.assertDisplayed();
    await settingsPage.topNav.assertDisplayed();
    await expect(settingsPage.saveButton).toBeVisible();
  });
});
```

## 4. Write one test per user action

Happy path and error path each get their own test, and each phase is a
`test.step`:

```ts
test.describe("settings page", () => {
  test("save the library paths", async ({ settingsPage, expectMutation }) => {
    await test.step("open the settings page", async () => {
      await settingsPage.goto();
    });

    await test.step("save the form", async () => {
      await expectMutation(settings.save(paths), () => settingsPage.save());
      await expect(settingsPage.statusMessage).toHaveText("Settings saved.");
    });
  });
});
```

**Error path:** call the page object's `forceServerError(url)` (or add a stub
method like it) before the action, and keep the `expectMutation`, wrapping its
contract in `failing(…)` from `utils/api.ts` so the request is still proven to
fire with a 500. Assert the UI surfaces the error.

```ts
await checkIn.forceServerError(scanUrls.search);
await expectMutation(failing(scan.search(query)), () =>
  checkIn.searchByTitle(query),
);
await expect(checkIn.errorMessage).toBeVisible();
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
