import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The rating card in the book detail hero: your stars and what they say. */
export class RatingComponent extends BaseComponent {
  readonly starsGroup: Locator;
  readonly metaText: Locator;

  constructor(page: Page) {
    super(page);
    this.starsGroup = page.getByRole("group", { name: "Your rating" });
    // Another status line shares the page, so the meta is found by test id.
    this.metaText = page.getByTestId("rating-meta");
  }
}
