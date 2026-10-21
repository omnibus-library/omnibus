import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * The chrome the comic pager (`ComicReaderPage`) and the PDF reader
 * (`PdfReaderPage`) share: back, title, fit modes, page buttons and slider.
 * Each subclass owns its route, stage and page label.
 */
export abstract class PagedReaderPage extends BasePage {
  readonly backButton: Locator;
  readonly titleHeading: Locator;
  readonly fitWidthButton: Locator;
  readonly fitHeightButton: Locator;
  readonly previousPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly pageSlider: Locator;

  constructor(page: Page) {
    super(page);
    this.backButton = page.getByRole("button", { name: "Back", exact: true });
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.fitWidthButton = page.getByRole("button", { name: "Fit width" });
    this.fitHeightButton = page.getByRole("button", { name: "Fit height" });
    this.previousPageButton = page.getByRole("button", {
      name: "Previous page",
    });
    this.nextPageButton = page.getByRole("button", { name: "Next page" });
    this.pageSlider = page.getByRole("slider", { name: "Page slider" });
  }

  async fitToWidth(): Promise<void> {
    await this.fitWidthButton.click();
  }

  /** Only clicks: a test that asserts the save wraps it in `expectMutation`. */
  async turnPage(): Promise<void> {
    await this.nextPageButton.click();
  }

  /** Jumps to the 0-based page `index`; the test awaits any save. */
  async slideToPage(index: number): Promise<void> {
    await this.pageSlider.fill(String(index));
  }
}
