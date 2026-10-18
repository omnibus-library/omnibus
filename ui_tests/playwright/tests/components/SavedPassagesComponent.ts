import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The "Passages you saved" stop: a book's highlights, or the note that it has none. */
export class SavedPassagesComponent extends BaseComponent {
  readonly heading: Locator;
  readonly section: Locator;
  readonly emptyMessage: Locator;
  readonly cards: Locator;
  readonly showMoreButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { name: "Passages you saved" });
    this.section = page.getByTestId("highlights-section");
    this.emptyMessage = page.getByTestId("highlights-empty");
    this.cards = page.getByTestId("highlight-card");
    this.showMoreButton = page.getByTestId("highlights-show-more");
  }

  /** The quote's text wherever it shows on the page, cards and modals alike. */
  quoteText(quote: string): Locator {
    return this.page.getByText(quote);
  }
}
