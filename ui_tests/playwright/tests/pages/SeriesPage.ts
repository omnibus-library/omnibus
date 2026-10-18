import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/** A series' page at `/series/:id`, which a book's series kicker opens. */
export class SeriesPage extends BasePage {
  protected readonly urlPattern = /\/series\/\d+$/;

  readonly titleHeading: Locator;

  constructor(page: Page) {
    super(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }
}
