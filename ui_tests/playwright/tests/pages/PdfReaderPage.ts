import type { Locator, Page, Response } from "@playwright/test";
import { HighlightsDrawerComponent } from "../components/HighlightsDrawerComponent";
import { expect } from "../fixtures/test";
import { PagedReaderPage } from "./PagedReaderPage";

/**
 * The PDF reader at `/pdf/:uuid`: PDF.js paints the page into a canvas with a
 * text layer over it, so the page's own text is the thing a spec reads.
 */
export class PdfReaderPage extends PagedReaderPage {
  protected readonly urlPattern = /\/pdf\/[^/?#]+(?:\?[^#]*)?$/;

  readonly highlightsDrawer: HighlightsDrawerComponent;

  readonly loadingOverlay: Locator;
  readonly stagePanel: Locator;
  readonly pageCanvas: Locator;
  readonly textLayer: Locator;
  readonly pageLabel: Locator;
  readonly highlightsButton: Locator;
  readonly bookmarksButton: Locator;

  constructor(page: Page) {
    super(page);
    this.highlightsDrawer = new HighlightsDrawerComponent(page);
    this.loadingOverlay = page.getByTestId("pdf-loading");
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
  }

  /** The label reads "Page N of M" once the first page has rasterised. */
  protected get readyLocator(): Locator {
    return this.pageLabel.filter({ hasText: /^Page \d+ of \d+$/ });
  }

  async goto(bookUuid: string): Promise<void> {
    await this.openAndSettle(`/pdf/${bookUuid}`);
    await this.loadingOverlay.waitFor({ state: "detached", timeout: 20_000 });
  }

  async openHighlights(): Promise<void> {
    await this.highlightsButton.click();
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  /** Serves `pdf` as the book's file. */
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
    const expectedPage = pageNumber === undefined ? null : String(pageNumber);
    await expect(this.page).toHaveURL(
      (url) =>
        url.pathname === `/pdf/${bookUuid}` &&
        url.searchParams.get("page") === expectedPage,
    );
    await expect(this.readyLocator).toBeVisible();
  }
}
