import type { Locator, Page, Request } from "@playwright/test";
import type { PreferenceTheme } from "../components/TopNavComponent";
import { authUrls } from "../contracts/auth";
import { expect } from "../fixtures/test";
import type { ForcedRequest } from "../utils/api";
import { waitForHydration } from "../utils/nav";

const DOCUMENT_MARK = "__omnibusE2eDocument";

/** Navigation and the displayed check that every page object shares. */
export abstract class BasePage {
  protected abstract readonly urlPattern: RegExp;

  /** Bounds `open`'s wait for `readyLocator`, in ms; unset keeps the default. */
  protected readonly readyTimeout?: number;

  readonly themeRoot: Locator;

  constructor(readonly page: Page) {
    this.themeRoot = page.locator("div.atrium").first();
  }

  protected abstract get readyLocator(): Locator;

  /** Checks the URL and that the page's ready marker is showing. */
  async assertDisplayed(): Promise<void> {
    await this.assertDisplayedAt(this.urlPattern);
  }

  /** Checks the URL matches `url` and the page's ready marker is showing. */
  protected async assertDisplayedAt(url: RegExp): Promise<void> {
    await expect(this.page).toHaveURL(url);
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
  async forceServerError(contract: ForcedRequest): Promise<void> {
    await this.forceServerErrorWhere(contract, () => true);
  }

  /** Fails the requests `contract` describes that `when` accepts; the rest go through. */
  async forceServerErrorWhere(
    contract: ForcedRequest,
    when: (request: Request) => boolean,
  ): Promise<void> {
    await this.page.route(contract.url, (route) =>
      route.request().method() === contract.method && when(route.request())
        ? route.fulfill({
            status: 500,
            contentType: "text/plain",
            body: "forced failure",
          })
        : route.continue(),
    );
  }

  /** Lets requests `contract` describes through again after a forced error. */
  async stopForcingServerError(contract: ForcedRequest): Promise<void> {
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
  async presetTheme(theme: PreferenceTheme): Promise<void> {
    await this.presetLocalStorage("omn.theme", theme);
  }

  /** The theme the browser persisted, which the next load applies. */
  storedTheme(): Promise<string | null> {
    return this.page.evaluate(() => window.localStorage.getItem("omn.theme"));
  }

  /** Resizes the window, which the page's breakpoints react to. */
  async resizeViewport(size: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize(size);
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

  /** Opens an address that predates this page, which redirects here. */
  async gotoLegacy(path: string): Promise<void> {
    await this.openAndSettle(path);
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
