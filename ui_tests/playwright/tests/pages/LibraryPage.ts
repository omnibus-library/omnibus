import type { Locator, Page } from "@playwright/test";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { ContinueStackComponent } from "../components/ContinueStackComponent";
import { LibraryTableComponent } from "../components/LibraryTableComponent";
import { TopNavComponent } from "../components/TopNavComponent";
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
  readonly libraryGrid = this.page.getByTestId("lib-grid");

  /** The link on a table row's cover cell that opens the book. */
  tableRowOpenLink(slug: string, title: string): Locator {
    return this.table
      .row(slug)
      .getByRole("link", { name: `Open details for ${title}` });
  }

  async openFromTable(slug: string, title: string): Promise<void> {
    await this.tableRowOpenLink(slug, title).click();
  }

  /** Follows the top nav's Library link, from whichever page the reader is on. */
  async openFromNav(): Promise<void> {
    await this.topNav.libraryLink.click();
  }
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
  // #endregion batch-I

  // #region batch-J: audio and cross-format
  // #endregion batch-J
}
