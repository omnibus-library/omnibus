import type { Page } from "@playwright/test";

// Wait until the React client has mounted into `#root`. `index.html` already
// paints a loader there before the bundle runs, so a child proves nothing:
// wait for the mark `createRoot` leaves on its container instead.
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.getElementById("root");
    return (
      root !== null &&
      Object.keys(root).some((key) => key.startsWith("__reactContainer$"))
    );
  });
}
