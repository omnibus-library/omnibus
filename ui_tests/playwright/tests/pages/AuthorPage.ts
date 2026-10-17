import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/** An author's page at `/authors/:id`, which a book's authors line opens. */
export class AuthorPage extends BasePage {
  protected readonly urlPattern = /\/authors\/\d+$/;

  readonly titleHeading: Locator;

  constructor(page: Page) {
    super(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }
}
