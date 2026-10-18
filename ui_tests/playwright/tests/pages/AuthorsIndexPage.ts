import type { Locator, Page } from "@playwright/test";
import { PageScrollComponent } from "../components/PageScrollComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

/** The authors list at `/authors`, previewing an author in the pane beside it. */
export class AuthorsIndexPage extends BasePage {
  // The trailing slash is optional: a delete redirects here and either form is accepted.
  protected readonly urlPattern = /\/authors\/?$/;

  readonly topNav: TopNavComponent;
  readonly scroll: PageScrollComponent;

  readonly filterField: Locator;
  readonly heading: Locator;
  readonly sortByNameButton: Locator;
  readonly sortByCountButton: Locator;
  readonly sortByRecentButton: Locator;
  readonly readingFilterButton: Locator;
  readonly cards: Locator;
  readonly firstCard: Locator;
  readonly firstRowBar: Locator;
  /** The previewed author's name in the pane. */
  readonly previewName: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.scroll = new PageScrollComponent(page);
    this.filterField = page.getByTestId("authors-filter");
    this.heading = page.getByRole("heading", { level: 1 });
    this.sortByNameButton = page.getByTestId("authors-sort-name");
    this.sortByCountButton = page.getByTestId("authors-sort-count");
    this.sortByRecentButton = page.getByTestId("authors-sort-recent");
    this.readingFilterButton = page.getByTestId("authors-reading-filter");
    this.cards = page.getByTestId("author-card");
    this.firstCard = this.cards.first();
    this.firstRowBar = page.getByTestId("author-row-bar").first();
    this.previewName = page.getByTestId("author-name");
  }

  protected get readyLocator(): Locator {
    return this.filterField;
  }

  /** `name`'s row, by the label that leads with the author's name. */
  card(name: string): Locator {
    return this.page.getByRole("link", { name: new RegExp(`^${name},`) });
  }

  /** The strip's link for authors whose surname starts with `letter`. */
  letterLink(letter: string): Locator {
    return this.page.getByTestId(`authors-letter-${letter}`);
  }

  /** The index section the strip's `letter` link scrolls to. */
  letterSection(letter: string): Locator {
    return this.page.locator(`#letter-${letter}`);
  }

  /** Where the first card links, such as `/authors/12`. */
  async firstCardPath(): Promise<string> {
    const href = await this.firstCard.getAttribute("href");
    if (href === null) throw new Error("the first author card has no href");
    return href;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/authors");
  }

  /** Returns once the server-rendered HTML arrives, before the client runs. */
  async gotoBeforeHydration(): Promise<void> {
    await this.page.goto("/authors", { waitUntil: "domcontentloaded" });
  }

  /** Fails the reader's progress request, which no server state can force. */
  async failReadingProgress(): Promise<void> {
    await this.page.route("**/api/rpc/authors/reading", (route) =>
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

  async openFirstCard(): Promise<void> {
    await this.firstCard.click();
  }

  /** Opens the last card, which a short viewport leaves at the bottom of the screen. */
  async openLastCard(): Promise<void> {
    await this.cards.last().click();
  }

  /** Checks the strip scrolled to `letter`'s section, as a same-page anchor. */
  async assertJumpedTo(letter: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`#letter-${letter}$`));
    await expect(this.letterSection(letter)).toBeInViewport();
  }
}
