import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The quote-card editor a saved passage opens in the app's modal shell. */
export class QuoteCardModalComponent extends BaseComponent {
  readonly root: Locator;
  readonly heading: Locator;
  readonly downloadButton: Locator;
  readonly copyImageButton: Locator;
  readonly preview: Locator;
  readonly previewBody: Locator;
  readonly sansButton: Locator;
  readonly italicButton: Locator;
  readonly boldButton: Locator;
  readonly largeButton: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("quote-card-modal");
    this.heading = this.root.getByRole("heading", {
      name: "Make a quote card",
    });
    this.downloadButton = this.root.getByTestId("quote-download");
    this.copyImageButton = this.root.getByTestId("quote-copy-image");
    this.preview = this.root.getByTestId("quote-preview");
    this.previewBody = this.root.getByTestId("quote-preview-body");
    this.sansButton = this.root.getByRole("button", {
      name: "Sans",
      exact: true,
    });
    this.italicButton = this.root.getByRole("button", {
      name: "Italic",
      exact: true,
    });
    this.boldButton = this.root.getByRole("button", {
      name: "Bold",
      exact: true,
    });
    this.largeButton = this.root.getByRole("button", {
      name: "L",
      exact: true,
    });
    this.closeButton = this.root.getByRole("button", { name: "Close" });
  }

  async pickSans(): Promise<void> {
    await this.sansButton.click();
  }

  async toggleItalic(): Promise<void> {
    await this.italicButton.click();
  }

  async toggleBold(): Promise<void> {
    await this.boldButton.click();
  }

  async pickLargeSize(): Promise<void> {
    await this.largeButton.click();
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }
}
