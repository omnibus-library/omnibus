import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The player's chapters and bookmarks drawers, and the toolbar buttons that open them. */
export class ListenDrawersComponent extends BaseComponent {
  readonly chaptersButton: Locator;
  readonly chaptersDrawer: Locator;
  readonly currentChapterRow: Locator;
  readonly nextChapterRow: Locator;

  readonly bookmarksButton: Locator;
  readonly bookmarksDrawer: Locator;
  readonly emptyBookmarksMessage: Locator;
  readonly addBookmarkHint: Locator;
  readonly addBookmarkButton: Locator;
  readonly firstBookmarkRow: Locator;
  readonly savedToast: Locator;
  readonly savedToastMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.chaptersButton = page.getByRole("button", { name: /^chapters/i });
    this.chaptersDrawer = page.getByTestId("chapters-drawer");
    // Several rows can be upcoming, and the first is the next chapter.
    this.currentChapterRow = page.getByTestId("chapter-row-current").first();
    this.nextChapterRow = page.getByTestId("chapter-row-upcoming").first();

    this.bookmarksButton = page.getByRole("button", { name: "Bookmark" });
    this.bookmarksDrawer = page.getByTestId("bookmarks-drawer");
    this.emptyBookmarksMessage = page.getByText("No bookmarks yet");
    this.addBookmarkHint = page.getByText("Tap + Bookmark above");
    this.addBookmarkButton = page.getByTestId("bookmark-add");
    this.firstBookmarkRow = page.getByTestId("bookmark-row").first();
    this.savedToast = page.getByTestId("bookmark-toast");
    this.savedToastMessage = page.getByText("Bookmark saved");
  }

  async openChapters(): Promise<void> {
    await this.chaptersButton.click();
  }

  async jumpToNextChapter(): Promise<void> {
    await this.nextChapterRow.click();
  }

  async openBookmarks(): Promise<void> {
    await this.bookmarksButton.click();
  }

  async addBookmark(): Promise<void> {
    await this.addBookmarkButton.click();
  }
}
