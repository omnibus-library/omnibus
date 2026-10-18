import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

/** The full-page results a palette genre row refines to, at `/search/genre:…`. */
export class GenreSearchPage extends BasePage {
  protected readonly urlPattern = /\/search\/genre:/;

  readonly bookRows: Locator;

  constructor(page: Page) {
    super(page);
    this.bookRows = page.getByTestId("search-book-row");
  }

  protected get readyLocator(): Locator {
    return this.bookRows;
  }

  /** Checks the page is searching the genre `genre`. */
  async assertDisplayedFor(genre: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/search/genre:${genre}$`));
  }
}
