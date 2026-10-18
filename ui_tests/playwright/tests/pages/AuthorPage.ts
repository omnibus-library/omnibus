import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** One author at `/authors/:id`: their books, series and photo. */
export class AuthorPage extends BasePage {
  protected readonly urlPattern = /\/authors\/\d+$/;

  readonly topNav: TopNavComponent;

  readonly heading: Locator;
  readonly libraryCountLabel: Locator;
  readonly letterAvatar: Locator;
  readonly photoAvatar: Locator;
  readonly deleteButton: Locator;
  readonly deleteDialog: Locator;
  readonly deleteCancelButton: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteErrorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.heading = page.getByRole("heading", { level: 1 });
    this.libraryCountLabel = page.getByText("In your library");
    this.letterAvatar = page.locator("div.disc-avatar");
    this.photoAvatar = page.locator("img.disc-avatar--photo");
    this.deleteButton = page.getByTestId("author-delete-btn");
    this.deleteDialog = page.getByTestId("author-delete-modal");
    this.deleteCancelButton = page.getByTestId("author-delete-cancel");
    this.deleteConfirmButton = page.getByTestId("author-delete-confirm");
    this.deleteErrorMessage = page.getByRole("alert");
  }

  protected get readyLocator(): Locator {
    return this.heading;
  }

  /** The heading of a series section, which links to that series' page. */
  seriesLink(name: string): Locator {
    return this.page.getByRole("link", { name });
  }

  bookTitle(title: string): Locator {
    return this.page.getByText(title);
  }

  async goto(authorId: number): Promise<void> {
    await this.openAndSettle(`/authors/${authorId}`);
  }

  async openSeries(name: string): Promise<void> {
    await this.seriesLink(name).click();
  }

  async openDeleteDialog(): Promise<void> {
    await this.deleteButton.click();
  }

  async cancelDelete(): Promise<void> {
    await this.deleteCancelButton.click();
  }

  async confirmDelete(): Promise<void> {
    await this.deleteConfirmButton.click();
  }

  /** Reads the photo's status from the page, so the session cookie rides along. */
  photoStatus(authorId: number): Promise<number> {
    return this.page.evaluate(
      async (url) => (await fetch(url)).status,
      `/api/authors/${authorId}/photo`,
    );
  }

  /** Checks the page is the author at `path`, such as `/authors/12`. */
  async assertDisplayedFor(path: string): Promise<void> {
    await this.assertDisplayedAt(new RegExp(`${path}$`));
  }
}
