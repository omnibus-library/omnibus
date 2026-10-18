import type { Locator, Page } from "@playwright/test";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { ContinueStackComponent } from "../components/ContinueStackComponent";
import { LibraryTableComponent } from "../components/LibraryTableComponent";
import { PageScrollComponent } from "../components/PageScrollComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { ebooksUrls } from "../contracts/ebooks";
import type { ShelfRef } from "../data/shelves";
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
  // #endregion batch-H

  // #region batch-I: search, nav and discovery
  readonly scroll = new PageScrollComponent(this.page);
  readonly sortSelect = this.page.getByTestId("lib-sort-select");
  readonly bookTiles = this.page.getByTestId(/^ebook-tile-/);
  readonly firstBookTile = this.bookTiles.first();

  /** The titles on the grid tiles, in the order they are painted. */
  tileTitles(): Promise<string[]> {
    return this.page.locator(".lib-tile-title").allTextContents();
  }

  async sortBy(option: string): Promise<void> {
    await this.sortSelect.selectOption(option);
  }

  /** Opens the last tile, which a short viewport leaves at the bottom of the screen. */
  async openLastBook(): Promise<void> {
    await this.bookTiles.last().click();
  }

  /** Records the body of every page fetch the library makes, in order. */
  recordPageFetches(): string[] {
    const bodies: string[] = [];
    this.page.on("request", (request) => {
      if (request.method() === "POST" && ebooksUrls.page.test(request.url())) {
        bodies.push(request.postData() ?? "");
      }
    });
    return bodies;
  }
  // #endregion batch-I

  // #region batch-J: audio and cross-format
  // #endregion batch-J
}
