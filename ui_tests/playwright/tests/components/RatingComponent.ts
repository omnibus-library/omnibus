import type { Locator, Page } from "@playwright/test";
import { ratingsUrls } from "../contracts/ratings";
import type { OtherRating } from "../data/bookDetail";
import { BaseComponent } from "./BaseComponent";

/** The hero's rating card: the reader's own stars and everyone else's. */
export class RatingComponent extends BaseComponent {
  readonly stars: Locator;
  readonly meta: Locator;
  readonly otherRatings: Locator;
  readonly otherRatingRow: Locator;
  readonly otherRatingByline: Locator;
  readonly otherRatingContent: Locator;

  constructor(page: Page) {
    super(page);
    this.stars = page.getByTestId("rating-stars");
    this.meta = page.getByTestId("rating-meta");
    this.otherRatings = page.getByTestId("other-ratings");
    this.otherRatingRow = page.getByTestId("other-rating-row");
    this.otherRatingByline = this.otherRatingRow.getByTestId(
      "other-rating-byline",
    );
    this.otherRatingContent = this.otherRatingRow.getByTestId(
      "other-rating-content",
    );
  }

  /** The stars an attributed rating draws, found by their label. */
  otherRatingStars(stars: number): Locator {
    return this.otherRatingRow.getByLabel(`${stars} out of 5 stars`);
  }

  /** The star half that sets a rating of `stars`. */
  rateButton(stars: number): Locator {
    return this.stars.getByRole("button", { name: `Rate ${stars} stars` });
  }

  /** The half a rating of `stars` leaves lit, which becomes the clear control. */
  clearButton(stars: number): Locator {
    return this.stars.getByRole("button", {
      name: `Clear your ${stars}-star rating`,
    });
  }

  async rate(stars: number): Promise<void> {
    await this.rateButton(stars).click();
  }

  async clear(stars: number): Promise<void> {
    await this.clearButton(stars).click();
  }

  /** Answers the other-readers read with `ratings`. */
  async stubOthers(ratings: OtherRating[]): Promise<void> {
    await this.page.route(ratingsUrls.others, (route) =>
      route.fulfill({ json: ratings }),
    );
  }
}
