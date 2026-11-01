import type { Locator, Page } from "@playwright/test";
import { holdRequests } from "../utils/api";
import { waitForApp } from "../utils/nav";
import { BaseComponent } from "./BaseComponent";

// The client's entry chunk, a hashed `/assets/index-….js` in the vite build.
const CLIENT_BUNDLE = /\/assets\/index-[^/]*\.js(\?|$)/;

/** What a page shows while the client's bundle download is held back. */
export class PreHydrationComponent extends BaseComponent {
  readonly pageLoader: Locator;
  readonly zeroBooksText: Locator;

  constructor(page: Page) {
    super(page);
    this.pageLoader = page
      .getByRole("status")
      .filter({ hasText: "Opening your library" });
    this.zeroBooksText = page.getByText(/\b0 books\b/);
  }

  /** Holds the client's bundle download; the release lets it go and waits for the app to mount. */
  async hold(): Promise<() => Promise<void>> {
    const release = await holdRequests(this.page, CLIENT_BUNDLE);
    return async () => {
      release();
      await waitForApp(this.page);
    };
  }
}
