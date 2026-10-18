import type { Locator, Page } from "@playwright/test";
import { holdRequests } from "../utils/api";
import { waitForHydration } from "../utils/nav";
import { BaseComponent } from "./BaseComponent";

// The app's wasm binary: `/wasm/omnibus_bg.wasm` under `dx serve`, a hashed
// `/assets/omnibus_bg-dxh….wasm` in the release bundle CI runs.
const CLIENT_WASM = /\/omnibus_bg[^/]*\.wasm(\?|$)/;

/** What a page shows while the client's wasm download is held back. */
export class PreHydrationComponent extends BaseComponent {
  readonly hydratedMarker: Locator;
  readonly libraryCountPending: Locator;
  readonly pageLoaderMark: Locator;
  readonly zeroBooksText: Locator;
  readonly authorsLoader: Locator;

  constructor(page: Page) {
    super(page);
    this.hydratedMarker = page.locator("html[data-hydrated]");
    this.libraryCountPending = page.getByTestId("lib-count-pending");
    this.pageLoaderMark = page.locator(".ld-riffle");
    this.zeroBooksText = page.getByText(/\b0 books\b/);
    this.authorsLoader = page
      .getByRole("status")
      .filter({ hasText: "Gathering every author" });
  }

  /** Holds the client's wasm download; the release lets it go and waits for the page to hydrate. */
  async hold(): Promise<() => Promise<void>> {
    const release = await holdRequests(this.page, CLIENT_WASM);
    return async () => {
      release();
      await waitForHydration(this.page);
    };
  }
}
