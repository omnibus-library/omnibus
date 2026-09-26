import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";
import { expectNavVisible, waitForHydration } from "../utils/nav";

// The boot screen covers the server-rendered shell until the WASM client
// hydrates (#2641). Before then the shell is inert — its links do full page
// loads and its buttons do nothing — so a reader must never be left looking
// at it. These tests hold the WASM download open to pin the pre-hydration
// window, which a warm local run otherwise closes in well under a second.

// Hold every `/wasm/*` request until the returned release is called. The
// bundle is an async module script, which the `load` event waits on, so a
// held page is navigated with `waitUntil: "domcontentloaded"`.
async function holdClient(page: Page): Promise<() => void> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/wasm/**", async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

test("renders the boot screen until the client hydrates", async ({ page }) => {
  const release = await holdClient(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const boot = page.getByTestId("boot-screen");
  await expect(boot).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Loading Omnibus" }),
  ).toBeVisible();
  await expect(boot).toContainText("Finding your place");
  await expect(boot.getByRole("link", { name: "Reload" })).toBeAttached();

  release();
  await waitForHydration(page);
  await expect(boot).toBeHidden();
  await expectNavVisible(page);
});

test("wears the reader's saved theme before the client runs", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("omn.theme", "sepia"));
  const release = await holdClient(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Nothing but the inline boot script can have set it yet: the client that
  // normally applies the saved theme is still being held.
  await expect(page.locator("html[data-hydrated]")).toHaveCount(0);
  const root = page.locator("div.atrium").first();
  await expect(root).toHaveAttribute("data-theme", "sepia");

  release();
  await waitForHydration(page);
  await expect(root).toHaveAttribute("data-theme", "sepia");
});
