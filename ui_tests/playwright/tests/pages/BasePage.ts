import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { waitForHydration } from "../utils/nav";

/** Navigation and the displayed check that every page object shares. */
export abstract class BasePage {
  protected abstract readonly urlPattern: RegExp;

  constructor(readonly page: Page) {}

  protected abstract get readyLocator(): Locator;

  /** Checks the URL and that the page's ready marker is showing. */
  async assertDisplayed(): Promise<void> {
    await expect(this.page).toHaveURL(this.urlPattern);
    await expect(this.readyLocator).toBeVisible();
  }

  /** Navigates to `path` and waits until the hydrated page is ready. */
  protected async open(path: string): Promise<void> {
    await this.page.goto(path);
    await waitForHydration(this.page);
    await this.readyLocator.waitFor();
  }
}
