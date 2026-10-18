import type { Locator, Page } from "@playwright/test";
import type { Theme } from "../components/TopNavComponent";
import { authUrls } from "../contracts/auth";
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

  /** Lets requests `contract` describes through again after a forced error. */
  async stopForcingServerError(contract: ExpectMutationOptions): Promise<void> {
    await this.page.unroute(contract.url);
  }

  /** Pins whether signup is open, which differs between a fresh CI database and a dev one. */
  async stubRegistrationOpen(open: boolean): Promise<void> {
    await this.page.route(authUrls.registration, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: open }),
      }),
    );
  }

  /** Stores the theme before every load of this page, as if chosen earlier. */
  async presetTheme(theme: Theme | "sepia"): Promise<void> {
    await this.presetLocalStorage("omn.theme", theme);
  }

  protected async presetLocalStorage(
    key: string,
    value: string,
  ): Promise<void> {
    await this.page.addInitScript(
      (entry) => window.localStorage.setItem(entry.key, entry.value),
      { key, value },
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
