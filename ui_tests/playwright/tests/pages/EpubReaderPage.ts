import type { Locator, Page } from "@playwright/test";
import { HighlightsDrawerComponent } from "../components/HighlightsDrawerComponent";
import { ReaderContentsDrawerComponent } from "../components/ReaderContentsDrawerComponent";
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
  readonly contentsDrawer: ReaderContentsDrawerComponent;
  readonly highlightsDrawer: HighlightsDrawerComponent;

  readonly viewerPanel: Locator;
  readonly backButton: Locator;
  readonly contentsButton: Locator;
  readonly searchButton: Locator;
  readonly displayPanelButton: Locator;
  readonly highlightsButton: Locator;
  readonly bookmarkButton: Locator;
  readonly previousPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly annotationsButton: Locator;
  readonly chapterCounterLabel: Locator;

  readonly searchDrawer: Locator;
  readonly searchField: Locator;
  readonly bookmarksDrawer: Locator;
  readonly addBookmarkButton: Locator;
  readonly annotationsSheet: Locator;
  readonly bookmarksFilterButton: Locator;
  readonly addAnnotationButton: Locator;

  constructor(page: Page) {
    super(page);
    this.displayPanel = new ReaderDisplayPanelComponent(page);
    this.contentsDrawer = new ReaderContentsDrawerComponent(page);
    this.highlightsDrawer = new HighlightsDrawerComponent(page);
    this.viewerPanel = page.getByTestId("reader-viewer");
    this.backButton = page.getByTestId("reader-back");
    this.contentsButton = page.getByTestId("reader-toc");
    this.searchButton = page.getByTestId("reader-search");
    this.displayPanelButton = page.getByTestId("reader-aa");
    this.highlightsButton = page.getByTestId("reader-highlights");
    this.bookmarkButton = page.getByTestId("reader-bookmark");
    this.previousPageButton = page.getByTestId("reader-prev");
    this.nextPageButton = page.getByTestId("reader-next");
    this.annotationsButton = page.getByTestId("reader-annotations");
    this.chapterCounterLabel = page.getByTestId("reader-chapter-counter");
    this.searchDrawer = page.getByTestId("reader-search-drawer");
    this.searchField = page.getByTestId("reader-search-input");
    this.bookmarksDrawer = page.getByTestId("reader-bookmarks-drawer");
    this.addBookmarkButton = page.getByTestId("reader-bookmark-add");
    this.annotationsSheet = page.getByTestId("reader-annotations-drawer");
    this.bookmarksFilterButton = page.getByTestId(
      "annotations-filter-bookmarks",
    );
    this.addAnnotationButton = page.getByTestId("reader-annotations-add");
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

  async openContents(): Promise<void> {
    await this.contentsButton.click();
  }

  async openSearch(): Promise<void> {
    await this.searchButton.click();
  }

  async openHighlights(): Promise<void> {
    await this.highlightsButton.click();
  }

  async openBookmarks(): Promise<void> {
    await this.bookmarkButton.click();
  }

  /** Opens the phone's one sheet for highlights, notes and bookmarks. */
  async openAnnotations(): Promise<void> {
    await this.annotationsButton.click();
  }

  async filterAnnotationsToBookmarks(): Promise<void> {
    await this.bookmarksFilterButton.click();
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  /** The width `element` paints at, or 0 when it paints no box at all. */
  async renderedWidth(element: Locator): Promise<number> {
    return (await element.boundingBox())?.width ?? 0;
  }

  /** Checks the page is reading the book `bookUuid`, not just any book. */
  async assertDisplayedFor(bookUuid: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/read/${bookUuid}$`));
    await expect(this.viewerPanel).toBeVisible();
  }
}
