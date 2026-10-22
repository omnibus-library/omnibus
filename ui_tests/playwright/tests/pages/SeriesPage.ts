import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

/** One series at `/series/:id`: its pane beside the series list. */
export class SeriesPage extends BasePage {
  protected readonly urlPattern = /\/series\/\d+$/;

  readonly topNav: TopNavComponent;

  /** The series' name: an h2, since the list beside it owns the page's h1. */
  readonly heading: Locator;
  /** "5 books · by …", the line under the name. */
  readonly meta: Locator;
  readonly readingStrip: Locator;
  readonly showInLibraryButton: Locator;
  /** The link back to the list, drawn only where the phone layout hides it. */
  readonly backLink: Locator;
  readonly bookCards: Locator;
  readonly firstCardNumberLabel: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.heading = page.getByTestId("series-name");
    this.meta = page.getByTestId("series-meta");
    this.readingStrip = page.getByTestId("series-reading");
    this.showInLibraryButton = page.getByTestId("series-show-in-library");
    this.backLink = page.getByTestId("series-back");
    this.bookCards = page.getByTestId("series-pane").getByRole("listitem");
    this.firstCardNumberLabel = this.bookCards.first().getByText(/^Book 1\b/);
  }

  protected get readyLocator(): Locator {
    return this.heading;
  }

  async goto(seriesId: number): Promise<void> {
    await this.openAndSettle(`/series/${seriesId}`);
  }

  /** Clicks the first cover's "Book 1" caption, which opens the book like the rest of it. */
  async openFirstBookFromItsNumber(): Promise<void> {
    await this.firstCardNumberLabel.click();
  }

  async goBackToList(): Promise<void> {
    await this.backLink.click();
  }

  /** Opens the library on `name`'s books, once its first page answers for them. */
  async showInLibrary(name: string): Promise<void> {
    const answered = this.page.waitForResponse(
      (res) =>
        res.url().includes("/api/rpc/ebooks/page") &&
        (res.request().postData() ?? "").includes(name),
    );
    await this.showInLibraryButton.click();
    await answered;
  }

  /** Checks the page is the series at `path`, such as `/series/12`. */
  async assertDisplayedFor(path: string): Promise<void> {
    await this.assertDisplayedAt(new RegExp(`${path}$`));
  }

  /** Checks the series page rendered: its name and the book count. */
  async assertShowsSeries(name: string): Promise<void> {
    await this.assertDisplayed();
    await expect(this.heading).toContainText(name);
    await expect(this.meta).toContainText("book");
  }
}
