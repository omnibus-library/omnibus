import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { PagedReaderPage } from "./PagedReaderPage";

/** The comic pager at `/comic/:uuid`: one page image at a time. */
export class ComicReaderPage extends PagedReaderPage {
  protected readonly urlPattern = /\/comic\/[^/?#]+$/;

  readonly stagePanel: Locator;
  readonly pageImage: Locator;
  readonly footerBar: Locator;
  readonly pageLabel: Locator;

  constructor(page: Page) {
    super(page);
    this.stagePanel = page.getByTestId("comic-stage");
    // The hidden prefetch images are out of the accessibility tree.
    this.pageImage = this.stagePanel.getByRole("img");
    this.footerBar = page.getByTestId("comic-footer");
    this.pageLabel = this.footerBar.getByText(/^Page \d+ of \d+$/);
  }

  /** The footer renders once the metadata and the saved position load. */
  protected get readyLocator(): Locator {
    return this.footerBar;
  }

  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/comic/${bookUuid}`);
  }

  /** The shown page's decoded width, so 0 until the bytes decode. */
  async pageImageWidth(): Promise<number> {
    return this.pageImage.evaluate((image) =>
      image instanceof HTMLImageElement ? image.naturalWidth : 0,
    );
  }

  /** Checks the pager is showing the book `bookUuid`, not just any comic. */
  async assertDisplayedFor(bookUuid: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/comic/${bookUuid}$`));
    await expect(this.footerBar).toBeVisible();
  }
}
