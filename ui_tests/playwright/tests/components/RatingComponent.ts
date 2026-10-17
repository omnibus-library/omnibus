import type { Locator, Page } from "@playwright/test";
import { ratingsUrls } from "../contracts/ratings";
import type { AttributedRating } from "../data/ratings";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** The rating card in the book detail hero: your stars and what they say. */
export class RatingComponent extends BaseComponent {
  readonly starsGroup: Locator;
  readonly metaText: Locator;
  readonly otherRatingsList: Locator;
  readonly otherRatingRow: Locator;
  readonly otherRatingByline: Locator;
  readonly otherRatingContent: Locator;

  constructor(page: Page) {
    super(page);
    this.starsGroup = page.getByRole("group", { name: "Your rating" });
    // Another status line shares the page, so the meta is found by test id.
    this.metaText = page.getByTestId("rating-meta");
    // Asserted absent, so found by test id, not by label.
    this.otherRatingsList = page.getByTestId("other-ratings");
    this.otherRatingRow = page.getByTestId("other-rating-row");
    this.otherRatingByline = this.otherRatingRow.getByTestId(
      "other-rating-byline",
    );
    this.otherRatingContent = this.otherRatingRow.getByTestId(
      "other-rating-content",
    );
  }

  /** The other reader's star row, named by its label, "4.5 out of 5 stars". */
  otherRatingStars(label: string): Locator {
    return this.otherRatingRow.getByLabel(label);
  }

  rateButton(stars: number): Locator {
    return this.starsGroup.getByRole("button", {
      name: stars === 1 ? "Rate 1 star" : `Rate ${stars} stars`,
      exact: true,
    });
  }

  /** The half star that holds the current rating; clicking it un-rates. */
  clearButton(stars: number): Locator {
    return this.starsGroup.getByRole("button", {
      name: `Clear your ${stars}-star rating`,
      exact: true,
    });
  }

  /** Clicks the star and waits for the save to answer. */
  async rate(stars: number): Promise<void> {
    const saved = this.page.waitForResponse(isPostTo(ratingsUrls.set));
    await this.rateButton(stars).click();
    await saved;
  }

  /** Clicks the rated star and waits for the clear to answer. */
  async clear(stars: number): Promise<void> {
    const cleared = this.page.waitForResponse(isPostTo(ratingsUrls.clear));
    await this.clearButton(stars).click();
    await cleared;
  }

  /** Answers the other readers' ratings with `ratings` on every later load. */
  async stubOtherRatings(ratings: AttributedRating[]): Promise<void> {
    await this.page.route(ratingsUrls.others, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ratings),
      }),
    );
  }
}
