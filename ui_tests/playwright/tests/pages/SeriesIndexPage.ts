import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** The series index at `/series`. */
export class SeriesIndexPage extends BasePage {
  protected readonly urlPattern = /\/series$/;

  readonly topNav: TopNavComponent;

  readonly filterField: Locator;
  readonly heading: Locator;
  readonly sortByNameButton: Locator;
  readonly sortByCountButton: Locator;
  readonly cards: Locator;
  readonly firstCard: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.filterField = page.getByTestId("series-filter");
    this.heading = page.getByRole("heading", { level: 1 });
    this.sortByNameButton = page.getByTestId("series-sort-name");
    this.sortByCountButton = page.getByTestId("series-sort-count");
    this.cards = page.getByTestId("series-card");
    this.firstCard = this.cards.first();
  }

  protected get readyLocator(): Locator {
    return this.filterField;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/series");
  }

  async filterBy(text: string): Promise<void> {
    await this.filterField.fill(text);
  }

  async sortByCount(): Promise<void> {
    await this.sortByCountButton.click();
  }

  async openFirstCard(): Promise<void> {
    await this.firstCard.click();
  }
}
