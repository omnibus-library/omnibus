import type { Locator, Page } from "@playwright/test";
import { HighlightsDrawerComponent } from "../components/HighlightsDrawerComponent";
import { ReaderContentsDrawerComponent } from "../components/ReaderContentsDrawerComponent";
import {
  ReaderDisplayPanelComponent,
  type Typeface,
} from "../components/ReaderDisplayPanelComponent";
import { ReaderSectionComponent } from "../components/ReaderSectionComponent";
import { progressUrls } from "../contracts/progress";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

export type ContentsEntry = { label: string; href: string; level: number };
export type Theme = "dark" | "black" | "light" | "sepia";

/**
 * The EPUB reader at `/read/:uuid`: its chrome, drawers and page turns. The
 * rendered book lives in the section component, not here.
 */
export class EpubReaderPage extends BasePage {
  protected readonly urlPattern = /\/read\/[^/?#]+(?:\?[^#]*)?$/;

  readonly section: ReaderSectionComponent;
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
  readonly headerChapterLabel: Locator;
  readonly loadingOverlay: Locator;
  readonly errorMessage: Locator;
  readonly retryButton: Locator;
  readonly navErrorMessage: Locator;

  readonly searchDrawer: Locator;
  readonly searchField: Locator;
  readonly bookmarksDrawer: Locator;
  readonly addBookmarkButton: Locator;
  readonly annotationsSheet: Locator;
  readonly bookmarksFilterButton: Locator;
  readonly addAnnotationButton: Locator;

  constructor(page: Page) {
    super(page);
    this.section = new ReaderSectionComponent(page);
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
    this.headerChapterLabel = page.getByTestId("reader-header-chapter");
    this.loadingOverlay = page.getByTestId("reader-loading");
    this.errorMessage = page.getByTestId("reader-error");
    this.retryButton = page.getByTestId("reader-retry");
    this.navErrorMessage = page.getByTestId("reader-nav-error");
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

  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/read/${bookUuid}`);
  }

  /** Opens the book at `cfi`, as a saved passage's link does. */
  async gotoPassage(bookUuid: string, cfi: string): Promise<void> {
    await this.openAndSettle(
      `/read/${bookUuid}?cfi=${encodeURIComponent(cfi)}`,
    );
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

  async reload(): Promise<void> {
    await this.page.reload();
  }

  async resizeViewport(size: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize(size);
  }

  async turnPage(): Promise<void> {
    await this.nextPageButton.click();
  }

  async turnBack(): Promise<void> {
    await this.previousPageButton.click();
  }

  async retry(): Promise<void> {
    await this.retryButton.click();
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

  /** The height `element` paints at, or 0 when it paints no box at all. */
  async renderedHeight(element: Locator): Promise<number> {
    return (await element.boundingBox())?.height ?? 0;
  }

  /** Listens for CSP refusals to load a stylesheet; the list fills as they come. */
  recordStylesheetCspRefusals(): string[] {
    return this.recordCspRefusals(/style-src|stylesheet/i);
  }

  /** Listens for CSP refusals to load a font; the list fills as they come. */
  recordFontCspRefusals(): string[] {
    return this.recordCspRefusals(/font-src|load the font/i);
  }

  /** Listens for requests for a reader font, from this origin or Google. */
  recordFontRequests(): string[] {
    const urls: string[] = [];
    this.page.on("request", (request) => {
      if (/reader-fonts|fonts\.g(static|oogleapis)/.test(request.url())) {
        urls.push(request.url());
      }
    });
    return urls;
  }

  /** Stores the theme before the next load, as if the reader chose it earlier. */
  async presetTheme(theme: Theme): Promise<void> {
    await this.presetLocalStorage("omn.theme", theme);
  }

  /** Stores the typeface before the next load, as presetTheme does. */
  async presetTypeface(face: Typeface): Promise<void> {
    await this.presetLocalStorage("omn.typeface", face);
  }

  /** Whether the failed-jump notice would swallow a click at its own centre. */
  async navErrorInterceptsPointer(): Promise<boolean> {
    const box = await this.navErrorMessage.boundingBox();
    if (!box) throw new Error("reader-nav-error has no bounding box");
    return this.page.evaluate(
      ({ x, y }) =>
        !!document
          .elementFromPoint(x, y)
          ?.closest('[data-testid="reader-nav-error"]'),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
  }

  /** Replaces the contents entries; call it once the loading overlay clears. */
  async stubContents(entries: ContentsEntry[]): Promise<void> {
    await this.page.evaluate((json) => {
      const onToc = Reflect.get(window, "__omnibusOnToc");
      if (typeof onToc !== "function") throw new Error("no contents glue");
      onToc(json);
    }, JSON.stringify(entries));
  }

  /** Delays the JSZip script, so epub.js can run first (#2449). */
  async holdBackJsZip(): Promise<void> {
    await this.page.route(/\/jszip[^/]*\.js$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
  }

  /** Aborts the first load of epub.js and lets every later one through. */
  async failEpubScriptOnce(): Promise<void> {
    let aborted = false;
    await this.page.route(/\/epub\.min[^/]*\.js$/, async (route) => {
      if (aborted) return route.continue();
      aborted = true;
      await route.abort();
    });
  }

  /** Serves `epub` as the book's file and keeps progress off the server. */
  async stubBookFile(bookUuid: string, epub: Buffer): Promise<void> {
    await this.page.route(`**/api/ebooks/${bookUuid}/file**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/epub+zip",
        body: epub,
      }),
    );
    await this.page.route(progressUrls.get, (route) =>
      route.fulfill({ json: null }),
    );
    await this.page.route(progressUrls.save, (route) =>
      route.fulfill({ json: {} }),
    );
  }

  /** Checks the page is reading the book `bookUuid`, not just any book. */
  async assertDisplayedFor(bookUuid: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/read/${bookUuid}$`));
    await expect(this.viewerPanel).toBeVisible();
  }

  private async presetLocalStorage(key: string, value: string): Promise<void> {
    await this.page.addInitScript(
      (entry) => window.localStorage.setItem(entry.key, entry.value),
      { key, value },
    );
  }

  /** CSP violations reach the console as error entries, iframe ones included. */
  private recordCspRefusals(directive: RegExp): string[] {
    const refusals: string[] = [];
    this.page.on("console", (message) => {
      const text = message.text();
      if (/content security policy/i.test(text) && directive.test(text)) {
        refusals.push(text);
      }
    });
    return refusals;
  }

  /** Opens `path`, then waits for the page's first fetches to settle. */
  private async openAndSettle(path: string): Promise<void> {
    await this.open(path);
    await this.page.waitForLoadState("networkidle");
  }
}
