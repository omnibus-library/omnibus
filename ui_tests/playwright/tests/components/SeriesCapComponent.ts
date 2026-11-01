import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The head card over a series stack once it is opened and its volumes dealt out. */
export class SeriesCapComponent extends BaseComponent {
  readonly root: Locator;
  readonly foldButton: Locator;
  readonly seriesPageLink: Locator;

  constructor(page: Page) {
    super(page);
    this.foldButton = page.getByRole("button", { name: /Fold up/ });
    this.root = page.getByRole("listitem").filter({ has: this.foldButton });
    this.seriesPageLink = page.getByRole("link", { name: "Series page →" });
  }

  async openSeriesPage(): Promise<void> {
    await this.seriesPageLink.click();
  }

  async foldWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }
}
