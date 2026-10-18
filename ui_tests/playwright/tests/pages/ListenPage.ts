import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

/** The audiobook player at `/listen/:uuid`. */
export class ListenPage extends BasePage {
  protected readonly urlPattern = /\/listen\/[^/?#]+(?:\?[^#]*)?$/;

  readonly titleHeading: Locator;

  constructor(page: Page) {
    super(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }

  /** Goes back in the history, which the app handles without a page load. */
  async historyBack(): Promise<void> {
    await this.page.goBack();
  }

  /** Checks the player is on the book `bookUuid`, at `fileId` when given. */
  async assertDisplayedFor(bookUuid: string, fileId?: number): Promise<void> {
    // #2256: without a file the url has no trailing `?`.
    const query = fileId === undefined ? "" : `\\?file_id=${fileId}`;
    await expect(this.page).toHaveURL(
      new RegExp(`/listen/${bookUuid}${query}$`),
    );
    await expect(this.titleHeading).toBeVisible();
  }
}
