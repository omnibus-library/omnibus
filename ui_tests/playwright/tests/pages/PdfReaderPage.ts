import type { Locator, Page, Response } from "@playwright/test";
import { BookmarksDrawerComponent } from "../components/BookmarksDrawerComponent";
import { HighlightsDrawerComponent } from "../components/HighlightsDrawerComponent";
import { highlightsUrls } from "../contracts/highlights";
import type { HighlightColor } from "../data/highlights";
import { isPostTo } from "../utils/api";
import { PagedReaderPage } from "./PagedReaderPage";

/**
 * The PDF reader at `/pdf/:uuid`: PDF.js paints the page into a canvas with a
 * text layer over it, so the page's own text is the thing a spec reads.
 */
export class PdfReaderPage extends PagedReaderPage {
  protected readonly urlPattern = /\/pdf\/[^/?#]+(?:\?[^#]*)?$/;
  // PDF.js fetches, parses and rasterises the file before the label shows.
  protected readonly readyTimeout = 20_000;

  readonly highlightsDrawer: HighlightsDrawerComponent;
  readonly bookmarksDrawer: BookmarksDrawerComponent;

  readonly stagePanel: Locator;
  readonly pageCanvas: Locator;
  readonly textLayer: Locator;
  readonly pageLabel: Locator;
  readonly highlightsButton: Locator;
  readonly bookmarksButton: Locator;
  readonly selectionPopover: Locator;

  constructor(page: Page) {
    super(page);
    this.highlightsDrawer = new HighlightsDrawerComponent(page);
    this.bookmarksDrawer = new BookmarksDrawerComponent(page);
    this.stagePanel = page.getByTestId("pdf-stage");
    // PDF.js generates the canvas and the text layer with no role or test id.
    this.pageCanvas = page.locator(".pr-canvas");
    this.textLayer = page.locator(".pr-textlayer");
    this.pageLabel = page.getByTestId("pdf-page-label");
    this.highlightsButton = page.getByRole("button", {
      name: "Highlights and notes",
    });
    this.bookmarksButton = page
      .getByRole("group", { name: "Annotations" })
      .getByRole("button", { name: "Bookmarks" });
    this.selectionPopover = page.locator(".rd-selection-popover");
  }

  /** The label reads "Page N of M" once the first page has rasterised. */
  protected get readyLocator(): Locator {
    return this.pageLabel.filter({ hasText: /^Page \d+ of \d+$/ });
  }

  /** The swatch in the selection popover that highlights in `color`. */
  highlightSwatch(color: HighlightColor): Locator {
    return this.selectionPopover.getByRole("button", {
      name: `Highlight ${color}`,
    });
  }

  /** The marks PDF.js painted for the highlight saved at `range` in `color`. */
  paintedHighlight(range: string, color: HighlightColor): Locator {
    return this.page.locator(
      `.pr-hl[data-anchor="${range}"][data-color="${color}"]`,
    );
  }

  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/pdf/${bookUuid}`);
  }

  async openHighlights(): Promise<void> {
    await this.highlightsButton.click();
  }

  async openBookmarks(): Promise<void> {
    await this.bookmarksButton.click();
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  /**
   * Drags across the first run of text on the page. PDF.js lays one span per
   * run, so a drag from its left edge to past its right edge selects it.
   */
  async selectFirstTextRun(): Promise<void> {
    const run = this.textLayer
      .locator("span")
      .filter({ hasText: /\S{3,}/ })
      .first();
    await run.waitFor({ state: "attached", timeout: 15_000 });
    const box = await run.boundingBox();
    if (!box) throw new Error("the text run has no bounding box");
    const midY = box.y + box.height / 2;
    await this.page.mouse.move(box.x + 1, midY);
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + box.width * 0.5, midY, { steps: 4 });
    await this.page.mouse.move(box.x + box.width - 1, midY, { steps: 4 });
    await this.page.mouse.up();
  }

  /** Saves the selection in `color`, then waits for the server's answer. */
  async highlightSelection(color: HighlightColor): Promise<void> {
    const created = this.page.waitForResponse(isPostTo(highlightsUrls.create));
    await this.highlightSwatch(color).click();
    await created;
  }

  /**
   * Answers every request for the book's file with `pdf`; call it before
   * `goto`.
   */
  async stubBookFile(bookUuid: string, pdf: Buffer): Promise<void> {
    await this.page.route(`**/api/ebooks/${bookUuid}/file**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: pdf,
      }),
    );
  }

  /** Waits for the JPEG 2000 decoder's download; call it before `goto`. */
  waitForJpxDecoder(): Promise<Response> {
    return this.page.waitForResponse((response) =>
      response.url().includes("/pdfjs-wasm/openjpeg.wasm"),
    );
  }

  /** The M of "Page N of M", or NaN before a label shows. */
  async pageCount(): Promise<number> {
    const label = (await this.pageLabel.textContent()) ?? "";
    const count = /of (\d+)$/.exec(label);
    return count ? Number(count[1]) : Number.NaN;
  }

  /** The selected text, trimmed. */
  async selectedText(): Promise<string> {
    const selection = await this.page.evaluate(() =>
      String(window.getSelection()),
    );
    return selection.trim();
  }

  /** The canvas's backing width, so 0 until PDF.js has painted. */
  async canvasWidth(): Promise<number> {
    return this.pageCanvas.evaluate((canvas) =>
      canvas instanceof HTMLCanvasElement ? canvas.width : 0,
    );
  }

  /** The RGB the canvas holds at its centre. */
  async canvasCentrePixel(): Promise<[number, number, number]> {
    return this.pageCanvas.evaluate((canvas): [number, number, number] => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas has no 2d context");
      const { data } = context.getImageData(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
      );
      return [data[0]!, data[1]!, data[2]!];
    });
  }

  /** Checks the reader is on `bookUuid`, and on `pageNumber` if given. */
  async assertDisplayedFor(
    bookUuid: string,
    pageNumber?: number,
  ): Promise<void> {
    const query = pageNumber === undefined ? "" : `\\?page=${pageNumber}`;
    await this.assertDisplayedAt(new RegExp(`/pdf/${bookUuid}${query}$`));
  }
}
