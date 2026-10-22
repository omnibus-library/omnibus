import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

/** The series list at `/series`, previewing a series in the pane beside it. */
export class SeriesIndexPage extends BasePage {
  protected readonly urlPattern = /\/series\/?$/;

  readonly topNav: TopNavComponent;

  readonly filterField: Locator;
  readonly heading: Locator;
  readonly sortByNameButton: Locator;
  readonly sortByCountButton: Locator;
  readonly sortByRecentButton: Locator;
  readonly readingFilterButton: Locator;
  readonly cards: Locator;
  readonly firstCard: Locator;
  readonly firstRowBar: Locator;
  /** The previewed series' name in the pane. */
  readonly previewName: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.filterField = page.getByTestId("series-filter");
    this.heading = page.getByRole("heading", { level: 1 });
    this.sortByNameButton = page.getByTestId("series-sort-name");
    this.sortByCountButton = page.getByTestId("series-sort-count");
    this.sortByRecentButton = page.getByTestId("series-sort-recent");
    this.readingFilterButton = page.getByTestId("series-reading-filter");
    this.cards = page.getByTestId("series-card");
    this.firstCard = this.cards.first();
    this.firstRowBar = page.getByTestId("series-row-bar").first();
    this.previewName = page.getByTestId("series-name");
  }

  protected get readyLocator(): Locator {
    return this.filterField;
  }

  /** `name`'s row, by the label that leads with the series' name. */
  card(name: string): Locator {
    return this.page.getByRole("link", { name: new RegExp(`^${name},`) });
  }

  /** The rail's link for series filed under `letter`. */
  letterLink(letter: string): Locator {
    return this.page.getByTestId(`series-letter-${letter}`);
  }

  /** Where the first card links, such as `/series/12`. */
  async firstCardPath(): Promise<string> {
    const href = await this.firstCard.getAttribute("href");
    if (href === null) throw new Error("the first series card has no href");
    return href;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/series");
  }

  /** Fails the reader's progress request, which no server state can force. */
  async failReadingProgress(): Promise<void> {
    await this.page.route("**/api/rpc/series/reading", (route) =>
      route.fulfill({ status: 500, contentType: "text/plain", body: "boom" }),
    );
  }

  async filterBy(text: string): Promise<void> {
    await this.filterField.fill(text);
  }

  async sortByCount(): Promise<void> {
    await this.sortByCountButton.click();
  }

  async jumpToLetter(letter: string): Promise<void> {
    await this.letterLink(letter).click();
  }

  async openCard(name: string): Promise<void> {
    await this.card(name).click();
  }

  async openFirstCard(): Promise<void> {
    await this.firstCard.click();
  }

  /** Checks the rail scrolled to `letter`'s section, as a same-page anchor. */
  async assertJumpedTo(letter: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`#letter-${letter}$`));
    await expect(this.page.locator(`#letter-${letter}`)).toBeInViewport();
  }
}
