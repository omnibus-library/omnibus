import type { Page } from "@playwright/test";

// Wait until the Dioxus WASM client has hydrated: the app stamps
// `data-hydrated` on <html> from its first post-mount effect. Until then the
// server-rendered markup is inert — a click lands on it and no rsx handler runs.
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector("html[data-hydrated]", { state: "attached" });
}
