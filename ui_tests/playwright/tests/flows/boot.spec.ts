import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";
import { expectNavVisible, waitForHydration } from "../utils/nav";

// Before the WASM client hydrates, the server-rendered page is what a reader
// sees (#2641). There is no boot screen over it, so it must already be honest:
// the nav, then the same loaders the client will show — skeletons on the
// library, the page loader everywhere else — and never an empty state the data
// hasn't confirmed. These tests hold the WASM download open to pin that
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

test("renders the library as nav and skeletons before the client runs", async ({
  page,
}) => {
  const release = await holdClient(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.locator("html[data-hydrated]")).toHaveCount(0);
  await expectNavVisible(page);
  await expect(page.getByTestId("lib-loading")).toBeVisible();
  await expect(page.getByTestId("lib-count-pending")).toBeVisible();
  // Skeletons only: the library never shows the page loader's book.
  await expect(page.locator(".ld-riffle")).toHaveCount(0);
  await expect(page.getByText(/\b0 books\b/)).toHaveCount(0);

  release();
  await waitForHydration(page);
  await expect(page.getByTestId("lib-loading")).toHaveCount(0);
});

test("renders other pages as nav and the page loader before the client runs", async ({
  page,
}) => {
  const release = await holdClient(page);
  await page.goto("/authors", { waitUntil: "domcontentloaded" });

  await expect(page.locator("html[data-hydrated]")).toHaveCount(0);
  await expectNavVisible(page);
  const loader = page
    .getByRole("status")
    .filter({ hasText: "Gathering every author" });
  await expect(loader).toBeVisible();

  release();
  await waitForHydration(page);
  await expect(loader).toHaveCount(0);
  await expect(page.getByTestId("authors-filter")).toBeVisible();
});

test("wears the reader's saved theme before the client runs", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("omn.theme", "sepia"));
  const release = await holdClient(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Nothing but the inline pre-paint script can have set it yet: the client
  // that normally applies the saved theme is still being held.
  await expect(page.locator("html[data-hydrated]")).toHaveCount(0);
  const root = page.locator("div.atrium").first();
  await expect(root).toHaveAttribute("data-theme", "sepia");

  release();
  await waitForHydration(page);
  await expect(root).toHaveAttribute("data-theme", "sepia");
});
