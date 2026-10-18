import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

/** One series at `/series/:id`, listing its books in order. */
export class SeriesPage extends BasePage {
  protected readonly urlPattern = /\/series\/\d+$/;

  readonly topNav: TopNavComponent;

  readonly heading: Locator;
  readonly bookCountLabel: Locator;
  readonly bookCards: Locator;
  readonly firstCardNumberLabel: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.heading = page.getByRole("heading", { level: 1 });
    this.bookCountLabel = page.getByText(/in library/);
    this.bookCards = page.locator("article.series-card");
    this.firstCardNumberLabel = this.bookCards.first().getByText("Book #1");
  }

  protected get readyLocator(): Locator {
    return this.heading;
  }

  async goto(seriesId: number): Promise<void> {
    await this.openAndSettle(`/series/${seriesId}`);
  }

  /** Clicks the card at its "Book #1" label, so the click reaches the stretched-link overlay (the label itself is covered). */
  async openFirstBookFromItsNumber(): Promise<void> {
    const card = this.bookCards.first();
    const cardBox = await card.boundingBox();
    const labelBox = await this.firstCardNumberLabel.boundingBox();
    if (!cardBox || !labelBox) {
      throw new Error("expected the card and label to have a bounding box");
    }
    await card.click({
      position: {
        x: labelBox.x + labelBox.width / 2 - cardBox.x,
        y: labelBox.y + labelBox.height / 2 - cardBox.y,
      },
    });
  }

  /** Checks the series page rendered: its heading and the book count. */
  async assertShowsSeries(name: string): Promise<void> {
    await this.assertDisplayed();
    await expect(this.heading).toContainText(name);
    await expect(this.bookCountLabel).toBeVisible();
  }
}
