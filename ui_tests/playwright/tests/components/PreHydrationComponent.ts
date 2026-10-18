import type { Locator, Page } from "@playwright/test";
import { waitForHydration } from "../utils/nav";
import { BaseComponent } from "./BaseComponent";

// The app's wasm binary: `/wasm/omnibus_bg.wasm` under `dx serve`, a hashed
// `/assets/omnibus_bg-dxh….wasm` in the release bundle CI runs.
const CLIENT_WASM = /\/omnibus_bg[^/]*\.wasm(\?|$)/;

/** What a page shows while the client's wasm download is held back. */
export class PreHydrationComponent extends BaseComponent {
  readonly hydratedMarker: Locator;
  readonly appRoot: Locator;
  readonly libraryLoading: Locator;
  readonly libraryCountPending: Locator;
  readonly pageLoaderMark: Locator;
  readonly zeroBooksText: Locator;
  readonly authorsLoader: Locator;

  private releaseDownload = () => {};

  constructor(page: Page) {
    super(page);
    this.hydratedMarker = page.locator("html[data-hydrated]");
    this.appRoot = page.locator("div.atrium").first();
    this.libraryLoading = page.getByTestId("lib-loading");
    this.libraryCountPending = page.getByTestId("lib-count-pending");
    this.pageLoaderMark = page.locator(".ld-riffle");
    this.zeroBooksText = page.getByText(/\b0 books\b/);
    this.authorsLoader = page
      .getByRole("status")
      .filter({ hasText: "Gathering every author" });
  }

  /** Holds the client's wasm download until `release`. */
  async hold(): Promise<void> {
    const gate = new Promise<void>((resolve) => {
      this.releaseDownload = resolve;
    });
    await this.page.route(CLIENT_WASM, async (route) => {
      await gate;
      await route.continue();
    });
  }

  /** Lets the download go and waits for the client to hydrate the page. */
  async release(): Promise<void> {
    this.releaseDownload();
    await waitForHydration(this.page);
  }

  /** Stores the theme before every load, as if the reader had chosen it. */
  async presetSavedTheme(theme: string): Promise<void> {
    await this.page.addInitScript(
      (saved) => localStorage.setItem("omn.theme", saved),
      theme,
    );
  }
}
