import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** One author at `/authors/:id`: their pane beside the authors list. */
export class AuthorPage extends BasePage {
  protected readonly urlPattern = /\/authors\/\d+$/;

  readonly topNav: TopNavComponent;

  /** The author's name: an h2, since the list beside it owns the page's h1. */
  readonly heading: Locator;
  readonly meta: Locator;
  readonly readingStrip: Locator;
  readonly showInLibraryButton: Locator;
  readonly letterAvatar: Locator;
  readonly photoAvatar: Locator;
  readonly moreButton: Locator;
  readonly deleteButton: Locator;
  readonly deleteDialog: Locator;
  readonly deleteCancelButton: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteErrorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.heading = page.getByTestId("author-name");
    this.meta = page.getByTestId("author-meta");
    this.readingStrip = page.getByTestId("author-reading");
    this.showInLibraryButton = page.getByTestId("author-show-in-library");
    this.letterAvatar = page.locator("div.disc-avatar");
    this.photoAvatar = page.locator("img.disc-avatar--photo");
    this.moreButton = page.getByTestId("author-more");
    this.deleteButton = page.getByTestId("author-delete-btn");
    this.deleteDialog = page.getByTestId("author-delete-modal");
    this.deleteCancelButton = page.getByTestId("author-delete-cancel");
    this.deleteConfirmButton = page.getByTestId("author-delete-confirm");
    this.deleteErrorMessage = page.getByRole("alert");
  }

  protected get readyLocator(): Locator {
    return this.heading;
  }

  /** A series shelf's "Series page" link. */
  seriesLink(name: string): Locator {
    return this.page.getByRole("link", { name: `${name} series page` });
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

  /** Opens the ⋯ menu, an admin's only. */
  async openMoreMenu(): Promise<void> {
    await this.moreButton.click();
  }

  async openDeleteDialog(): Promise<void> {
    await this.openMoreMenu();
    await this.deleteButton.click();
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
