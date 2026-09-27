import type { Page } from "@playwright/test";
import { expect } from "../fixtures/test";

// Wait until the Dioxus WASM client has hydrated: the app stamps
// `data-hydrated` on <html> from its first post-mount effect, which is also
// what dismisses the boot screen. Until then the server-rendered markup is
// inert — a click lands on it and no rsx handler runs.
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector("html[data-hydrated]", { state: "attached" });
}

// Navigate, wait for hydration, then for the page's first fetches to settle.
// The marker comes first because `networkidle` alone can fire in the gap
// between the WASM download finishing and the client mounting.
export async function gotoReady(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForHydration(page);
  await page.waitForLoadState("networkidle");
}

// Asserts the shared top-nav is present with the expected links. Used by every
// flow's layout test so we catch nav regressions in one place. Settings now
// lives inside the user-menu dropdown, so we assert the user-menu trigger is
// present instead of a top-level Settings link.
export async function expectNavVisible(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(nav.getByTestId("user-menu-trigger")).toBeVisible();
}
