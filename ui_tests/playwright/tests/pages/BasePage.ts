import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import type { ExpectMutationOptions } from "../utils/api";
import { waitForHydration } from "../utils/nav";

const DOCUMENT_MARK = "__omnibusE2eDocument";

/** Navigation and the displayed check that every page object shares. */
export abstract class BasePage {
  protected abstract readonly urlPattern: RegExp;

  /** Bounds `open`'s wait for `readyLocator`, in ms; unset keeps the default. */
  protected readonly readyTimeout?: number;

  constructor(readonly page: Page) {}

  protected abstract get readyLocator(): Locator;

  /** Checks the URL and that the page's ready marker is showing. */
  async assertDisplayed(): Promise<void> {
    await expect(this.page).toHaveURL(this.urlPattern);
    await expect(this.readyLocator).toBeVisible();
  }

  /** Marks the loaded document; a full page load replaces it and drops the mark. */
  async markDocument(): Promise<void> {
    await this.page.evaluate((key) => {
      Reflect.set(window, key, true);
    }, DOCUMENT_MARK);
  }

  /** True while the marked document is still loaded, so no full page load ran. */
  async documentIsMarked(): Promise<boolean> {
    return this.page.evaluate(
      (key) => Reflect.get(window, key) === true,
      DOCUMENT_MARK,
    );
  }

  /** Fails every request `contract` describes from this page with a 500. */
  async forceServerError(contract: ExpectMutationOptions): Promise<void> {
    await this.page.route(contract.url, (route) =>
      route.request().method() === contract.method
        ? route.fulfill({
            status: 500,
            contentType: "text/plain",
            body: "forced failure",
          })
        : route.continue(),
    );
  }

  /** Lets the requests `forceServerError` failed for `contract` through again. */
  async clearServerError(contract: ExpectMutationOptions): Promise<void> {
    await this.page.unroute(contract.url);
  }

  /** Navigates to `path` and waits until the hydrated page is ready. */
  protected async open(path: string): Promise<void> {
    await this.page.goto(path);
    await waitForHydration(this.page);
    await this.readyLocator.waitFor({ timeout: this.readyTimeout });
  }

  /** Opens `path`, then waits for the page's first fetches to settle. */
  protected async openAndSettle(path: string): Promise<void> {
    await this.open(path);
    await this.page.waitForLoadState("networkidle");
  }
}
