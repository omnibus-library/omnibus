import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

/** The audiobook player at `/listen/:uuid`. */
export class ListenPage extends BasePage {
  protected readonly urlPattern = /\/listen\/[^/?#]+(?:\?.*)?$/;

  readonly chapterMap: Locator;

  constructor(page: Page) {
    super(page);
    this.chapterMap = page.getByTestId("chapter-map");
  }

  protected get readyLocator(): Locator {
    return this.chapterMap;
  }

  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/listen/${bookUuid}`);
  }

  /**
   * Checks the player is on `bookUuid`; `fileId` pins the part it plays, and
   * "any" accepts whichever part a picker chose.
   */
  async assertDisplayedFor(
    bookUuid: string,
    fileId?: number | "any",
  ): Promise<void> {
    const query =
      fileId === undefined
        ? ""
        : `\\?file_id=${fileId === "any" ? "\\d+" : fileId}`;
    await expect(this.page).toHaveURL(
      new RegExp(`/listen/${bookUuid}${query}$`),
    );
    await expect(this.chapterMap).toBeVisible();
  }
}
