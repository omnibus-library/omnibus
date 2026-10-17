import type { Locator, Page } from "@playwright/test";
import { bookmarksUrls } from "../contracts/bookmarks";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** The bookmarks drawer, shared by the EPUB reader and the PDF reader. */
export class BookmarksDrawerComponent extends BaseComponent {
  readonly root: Locator;
  readonly addButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("reader-bookmarks-drawer");
    this.addButton = this.root.getByRole("button", { name: "+ Bookmark" });
  }

  /**
   * The row of the bookmark titled exactly `title`, so "Page 4" never matches
   * "Page 40". The button's own name starts with a flag glyph, so the exact
   * match goes on the label.
   */
  row(title: string): Locator {
    return this.root
      .getByTestId("reader-bookmark-row")
      .filter({ has: this.page.getByText(title, { exact: true }) });
  }

  /** Bookmarks the current page, then waits for the server's answer. */
  async add(): Promise<void> {
    const created = this.page.waitForResponse(isPostTo(bookmarksUrls.create));
    await this.addButton.click();
    await created;
  }

  /** Only clicks: a test that asserts the save wraps it in `expectMutation`. */
  async jumpTo(title: string): Promise<void> {
    await this.row(title).getByRole("button", { name: title }).click();
  }
}
