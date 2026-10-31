import type { Page } from "@playwright/test";

// Wait until the React client has mounted into `#root`. There is no server
// render to hydrate, so this only spares a spec asserting against the bare
// `index.html` shell before the bundle has run.
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector("#root > *", { state: "attached" });
}
