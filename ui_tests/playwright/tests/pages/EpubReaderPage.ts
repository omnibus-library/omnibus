import type { Locator, Page } from "@playwright/test";
import { ReaderDisplayPanelComponent } from "../components/ReaderDisplayPanelComponent";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

/**
 * The EPUB reader at `/read/:uuid`: its chrome, drawers and page turns. The
 * rendered book lives in the section component, not here.
 */
export class EpubReaderPage extends BasePage {
  protected readonly urlPattern = /\/read\/[^/?#]+(?:\?[^#]*)?$/;

  readonly displayPanel: ReaderDisplayPanelComponent;

  readonly viewerPanel: Locator;
  readonly backButton: Locator;
  readonly contentsButton: Locator;
  readonly searchButton: Locator;
  readonly displayPanelButton: Locator;
  readonly highlightsButton: Locator;
  readonly bookmarkButton: Locator;
  readonly previousPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly chapterCounterLabel: Locator;

  constructor(page: Page) {
    super(page);
    this.displayPanel = new ReaderDisplayPanelComponent(page);
    this.viewerPanel = page.getByTestId("reader-viewer");
    this.backButton = page.getByTestId("reader-back");
    this.contentsButton = page.getByTestId("reader-toc");
    this.searchButton = page.getByTestId("reader-search");
    this.displayPanelButton = page.getByTestId("reader-aa");
    this.highlightsButton = page.getByTestId("reader-highlights");
    this.bookmarkButton = page.getByTestId("reader-bookmark");
    this.previousPageButton = page.getByTestId("reader-prev");
    this.nextPageButton = page.getByTestId("reader-next");
    this.chapterCounterLabel = page.getByTestId("reader-chapter-counter");
  }

  protected get readyLocator(): Locator {
    return this.viewerPanel;
  }

  /** Opens the book, then waits for the page's first fetches to settle. */
  async goto(bookUuid: string): Promise<void> {
    await this.open(`/read/${bookUuid}`);
    await this.page.waitForLoadState("networkidle");
  }

  async goBack(): Promise<void> {
    await this.backButton.click();
  }

  async openDisplayPanel(): Promise<void> {
    await this.displayPanelButton.click();
  }

  /** The same button opens and closes the panel. */
  async closeDisplayPanel(): Promise<void> {
    await this.displayPanelButton.click();
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  /** Checks the page is reading the book `bookUuid`, not just any book. */
  async assertDisplayedFor(bookUuid: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/read/${bookUuid}$`));
    await expect(this.viewerPanel).toBeVisible();
  }
}
