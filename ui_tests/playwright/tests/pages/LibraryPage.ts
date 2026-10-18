import type { Locator, Page } from "@playwright/test";
import { AddBooksModalComponent } from "../components/AddBooksModalComponent";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { ContinueStackComponent } from "../components/ContinueStackComponent";
import { FilterBarComponent } from "../components/FilterBarComponent";
import { LibraryTableComponent } from "../components/LibraryTableComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { ebooksUrls } from "../contracts/ebooks";
import type { ShelfRef } from "../data/shelves";
import { expect } from "../fixtures/test";
import { BasePage } from "./BasePage";

export class LibraryPage extends BasePage {
  protected readonly urlPattern = /\/$/;

  readonly topNav: TopNavComponent;
  readonly checkInOverlay: CheckInOverlayComponent;
  readonly table: LibraryTableComponent;
  readonly continueStack: ContinueStackComponent;

  readonly titleHeading: Locator;
  readonly sectionTitle: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.checkInOverlay = new CheckInOverlayComponent(page);
    this.table = new LibraryTableComponent(page);
    this.continueStack = new ContinueStackComponent(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.sectionTitle = page.getByTestId("lib-section-title");
  }

  protected get readyLocator(): Locator {
    return this.sectionTitle;
  }

  /** The shelf's tile in the gallery row above the book list. */
  galleryShelfTile(shelfId: number): Locator {
    return this.page.getByTestId(`gallery-shelf-${shelfId}`);
  }

  /** A book's grid tile: a `listitem`, not a link (see `landing/grid.rs`). */
  bookTile(title: string): Locator {
    return this.page.getByRole("listitem", {
      name: `Open details for ${title}`,
    });
  }

  async goto(): Promise<void> {
    await this.open("/");
  }

  /** Filters the book list to `shelf` in place; the page does not navigate. */
  async selectShelf(shelf: ShelfRef): Promise<void> {
    await this.galleryShelfTile(shelf.id).click();
    await this.sectionTitle.filter({ hasText: shelf.name }).waitFor();
  }

  // #region batch-C: book detail
  // #endregion batch-C

  // #region batch-E: metadata edit
  // #endregion batch-E

  // #region batch-F: landing and add books
  // #endregion batch-F

  // #region batch-G: shelves
  // #endregion batch-G

  // #region batch-H: filters and book-detail shelves
  readonly filterBar = new FilterBarComponent(this.page);
  readonly addBooksModal = new AddBooksModalComponent(this.page);

  readonly pageError = this.page.getByTestId("lib-page-error");
  readonly loading = this.page.getByTestId("lib-loading");
  readonly emptyLibraryMessage = this.page.getByTestId("lib-empty");
  readonly noMatchesMessage = this.page.getByText(
    "No books match these filters.",
  );
  readonly clearFiltersButton = this.page.getByRole("button", {
    name: "Clear filters",
  });
  readonly shelfAddBooksButton = this.page.getByTestId("shelf-add-books");

  /** Opens All Books and waits for its first fetches, as `goto` does not. */
  async gotoSettled(): Promise<void> {
    await this.openAndSettle("/");
  }

  async openAddBooks(): Promise<void> {
    await this.shelfAddBooksButton.click();
  }

  async clearFilters(): Promise<void> {
    await this.clearFiltersButton.click();
  }

  /** Lets the page fetch answer again after `forceServerError(ebooks.page())`. */
  async restoreLibraryReads(): Promise<void> {
    await this.page.unroute(ebooksUrls.page);
  }

  /** The slugs of the book tiles on the grid, sorted. */
  async tileSlugs(): Promise<string[]> {
    return this.page.getByTestId(/^ebook-tile-/).evaluateAll((tiles) =>
      tiles
        .map((t) => t.getAttribute("data-testid")?.slice("ebook-tile-".length))
        .filter((slug): slug is string => slug !== undefined)
        .sort(),
    );
  }

  /** The header's book count, or NaN while it shows none. */
  async shownCount(): Promise<number> {
    const text = await this.sectionTitle.textContent();
    return Number(/·\s*(\d+)\s+books?/.exec(text ?? "")?.[1]);
  }

  /** Counts every "No ebooks found." node the page inserts from now on. */
  async recordEmptyLibraryInsertions(): Promise<void> {
    await this.page.evaluate(() => {
      const seen = { count: 0 };
      Object.assign(window, { __emptyLibrarySeen: seen });
      new MutationObserver((mutations) => {
        for (const added of mutations.flatMap((m) => [...m.addedNodes])) {
          if (
            added instanceof Element &&
            (added.matches('[data-testid="lib-empty"]') ||
              added.querySelector('[data-testid="lib-empty"]'))
          ) {
            seen.count += 1;
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  /** What `recordEmptyLibraryInsertions` has counted so far. */
  async emptyLibraryInsertions(): Promise<number> {
    return this.page.evaluate(
      () =>
        (window as unknown as { __emptyLibrarySeen: { count: number } })
          .__emptyLibrarySeen.count,
    );
  }

  /** Checks the grid shows exactly these books and the header counts them. */
  async assertShowsBooks(slugs: string[]): Promise<void> {
    await expect
      .poll(() => this.tileSlugs(), { message: "tiles on the grid" })
      .toEqual([...slugs].sort());
    const count = slugs.length;
    await expect(this.sectionTitle).toContainText(
      `· ${count} ${count === 1 ? "book" : "books"}`,
    );
  }

  /** Checks every one of these books is on the grid, whatever else it holds. */
  async assertShowsBooksIncluding(slugs: string[]): Promise<void> {
    await expect
      .poll(() => this.tileSlugs(), { message: "tiles on the grid" })
      .toEqual(expect.arrayContaining(slugs));
  }
  // #endregion batch-H

  // #region batch-I: search, nav and discovery
  // #endregion batch-I

  // #region batch-J: audio and cross-format
  // #endregion batch-J
}
