import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import type { ExpectMutationOptions } from "../utils/api";
import { waitForHydration } from "../utils/nav";

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

  /** Reloads and waits until the hydrated page is ready again. */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.waitUntilReady();
  }

  /** Navigates to `path` and waits until the hydrated page is ready. */
  protected async open(path: string): Promise<void> {
    await this.page.goto(path);
    await this.waitUntilReady();
  }

  /** Opens `path`, then waits for the page's first fetches to settle. */
  protected async openAndSettle(path: string): Promise<void> {
    await this.open(path);
    await this.page.waitForLoadState("networkidle");
  }

  private async waitUntilReady(): Promise<void> {
    await waitForHydration(this.page);
    await this.readyLocator.waitFor({ timeout: this.readyTimeout });
  }

  /** Reloads, then waits for the page's first fetches to settle. */
  async reloadAndSettle(): Promise<void> {
    await this.reload();
    await this.page.waitForLoadState("networkidle");
  }

  /** Steps back in history and waits until the page is ready again. */
  async goBack(): Promise<void> {
    await this.page.goBack();
    await this.waitUntilReady();
  }
}
