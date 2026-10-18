import type { Locator, Page } from "@playwright/test";
import { AddBooksModalComponent } from "../components/AddBooksModalComponent";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { ContinueStackComponent } from "../components/ContinueStackComponent";
import { CreateShelfModalComponent } from "../components/CreateShelfModalComponent";
import { EditShelfModalComponent } from "../components/EditShelfModalComponent";
import { LibraryTableComponent } from "../components/LibraryTableComponent";
import { ShelfGalleryComponent } from "../components/ShelfGalleryComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { shelvesUrls } from "../contracts/shelves";
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
  readonly shelfGallery = new ShelfGalleryComponent(this.page);
  readonly createShelfModal = new CreateShelfModalComponent(this.page);
  readonly editShelfModal = new EditShelfModalComponent(this.page);
  readonly addBooksModal = new AddBooksModalComponent(this.page);

  readonly shelfEditButton = this.page.getByTestId("shelf-edit");
  readonly shelfAddBooksButton = this.page.getByTestId("shelf-add-books");
  readonly shelfAddBooksTile = this.page.getByTestId("shelf-add-tile");
  readonly shelfFacets = this.page.getByTestId("shelf-facets");
  readonly bookGrid = this.page.getByTestId("lib-grid");
  readonly lastBookGridItem = this.bookGrid.locator(":scope > *").last();
  readonly emptyMessage = this.page.getByTestId("lib-empty");
  readonly pageError = this.page.getByTestId("lib-page-error");
  readonly loadingIndicator = this.page.getByTestId("lib-loading");
  readonly sortSelect = this.page.getByTestId("lib-sort-select");
  readonly sortDirectionButton = this.page.getByTestId("lib-sort-dir");
  readonly sortLockedNote = this.page.getByTestId("lib-sort-locked");
  readonly gridViewButton = this.page.getByTestId("view-toggle-grid");
  readonly titleColumnHeader = this.page.getByRole("columnheader", {
    name: /Title/,
  });
  readonly titleSortButton = this.titleColumnHeader.getByRole("button");
  readonly navShelvesLink = this.page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Shelves" });

  private releaseHeldShelfReads: (() => void) | undefined;

  /** Opens the landing page and waits for its first fetches to settle. */
  async gotoSettled(): Promise<void> {
    await this.openAndSettle("/");
  }

  tableRowCount(): Promise<number> {
    return this.table.rows.count();
  }

  async switchToGrid(): Promise<void> {
    await this.gridViewButton.click();
  }

  async openAddBooks(): Promise<void> {
    await this.shelfAddBooksButton.click();
  }

  async openAddBooksFromTile(): Promise<void> {
    await this.shelfAddBooksTile.click();
  }

  async openEditShelf(): Promise<void> {
    await this.shelfEditButton.click();
  }

  /** Parks every shelf member read until `releaseShelfReads`. */
  async holdShelfReads(): Promise<void> {
    const held = new Promise<void>((resolve) => {
      this.releaseHeldShelfReads = resolve;
    });
    await this.page.route(shelvesUrls.page, async (route) => {
      await held;
      await route.continue();
    });
  }

  async releaseShelfReads(): Promise<void> {
    this.releaseHeldShelfReads?.();
    await this.page.unrouteAll({ behavior: "wait" });
  }

  /**
   * Opens the landing page until the book's resume card is on the stack,
   * writing a fresh position each try: the rail orders on a one-second stamp
   * with the uuid breaking ties, so a write that ties can sit off its end.
   */
  async assertResumeCardOnStack(
    bookUuid: string,
    seed: (bookUuid: string) => Promise<void>,
  ): Promise<void> {
    await expect
      .poll(
        async () => {
          await seed(bookUuid);
          await this.gotoSettled();
          return this.continueStack.card(bookUuid).count();
        },
        {
          timeout: 30_000,
          message: `book ${bookUuid} never reached the continue-reading stack`,
        },
      )
      .toBeGreaterThan(0);
  }
  // #endregion batch-G

  // #region batch-H: filters and book-detail shelves
  // #endregion batch-H

  // #region batch-I: search, nav and discovery
  // #endregion batch-I

  // #region batch-J: audio and cross-format
  // #endregion batch-J
}
