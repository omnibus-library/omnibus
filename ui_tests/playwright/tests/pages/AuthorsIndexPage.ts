import type { Locator, Page } from "@playwright/test";
import { PageScrollComponent } from "../components/PageScrollComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

/** The authors index at `/authors`. */
export class AuthorsIndexPage extends BasePage {
  // The trailing slash is optional: a delete redirects here and either form is accepted.
  protected readonly urlPattern = /\/authors\/?$/;

  readonly topNav: TopNavComponent;
  readonly scroll: PageScrollComponent;

  readonly filterField: Locator;
  readonly heading: Locator;
  readonly sortByNameButton: Locator;
  readonly sortByCountButton: Locator;
  readonly cards: Locator;
  readonly firstCard: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.scroll = new PageScrollComponent(page);
    this.filterField = page.getByTestId("authors-filter");
    this.heading = page.getByRole("heading", { level: 1 });
    this.sortByNameButton = page.getByTestId("authors-sort-name");
    this.sortByCountButton = page.getByTestId("authors-sort-count");
    this.cards = page.getByTestId("author-card");
    this.firstCard = this.cards.first();
  }

  protected get readyLocator(): Locator {
    return this.filterField;
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
