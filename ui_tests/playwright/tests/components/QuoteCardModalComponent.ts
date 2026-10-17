import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

export type QuoteFont = "Serif" | "Sans" | "Mono";
export type QuoteSize = "S" | "M" | "L";
export type QuoteStyle = "Bold" | "Italic";

/** The quote card editor a saved passage opens, and its typography controls. */
export class QuoteCardModalComponent extends BaseComponent {
  readonly root: Locator;
  readonly heading: Locator;
  readonly downloadButton: Locator;
  readonly copyButton: Locator;
  readonly closeButton: Locator;
  readonly preview: Locator;
  readonly previewBody: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("quote-card-modal");
    this.heading = this.root.getByRole("heading", {
      name: "Make a quote card",
    });
    this.downloadButton = this.root.getByRole("button", {
      name: "Download",
      exact: true,
    });
    this.copyButton = this.root.getByRole("button", {
      name: "Copy",
      exact: true,
    });
    this.closeButton = this.root.getByRole("button", { name: "Close" });
    this.preview = this.root.getByTestId("quote-preview");
    this.previewBody = this.root.getByTestId("quote-preview-body");
  }

  fontButton(font: QuoteFont): Locator {
    return this.root
      .getByRole("group", { name: "Font" })
      .getByRole("button", { name: font, exact: true });
  }

  sizeButton(size: QuoteSize): Locator {
    return this.root
      .getByRole("group", { name: "Text size" })
      .getByRole("button", { name: size, exact: true });
  }

  styleButton(style: QuoteStyle): Locator {
    return this.root
      .getByRole("group", { name: "Style" })
      .getByRole("button", { name: style, exact: true });
  }

  async chooseFont(font: QuoteFont): Promise<void> {
    await this.fontButton(font).click();
  }

  async chooseSize(size: QuoteSize): Promise<void> {
    await this.sizeButton(size).click();
  }

  async toggleStyle(style: QuoteStyle): Promise<void> {
    await this.styleButton(style).click();
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }
}
