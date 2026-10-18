import type { Locator, Page } from "@playwright/test";
import { AddBooksModalComponent } from "../components/AddBooksModalComponent";
import { AddBooksSheetComponent } from "../components/AddBooksSheetComponent";
import { BulkEditBarComponent } from "../components/BulkEditBarComponent";
import { BulkEditModalComponent } from "../components/BulkEditModalComponent";
import { CheckInOverlayComponent } from "../components/CheckInOverlayComponent";
import { ContinueStackComponent } from "../components/ContinueStackComponent";
import { CreateShelfModalComponent } from "../components/CreateShelfModalComponent";
import { EditShelfModalComponent } from "../components/EditShelfModalComponent";
import { FilterBarComponent } from "../components/FilterBarComponent";
import { LibraryTableComponent } from "../components/LibraryTableComponent";
import { SeriesCapComponent } from "../components/SeriesCapComponent";
import { ShelfGalleryComponent } from "../components/ShelfGalleryComponent";
import { TabBarComponent } from "../components/TabBarComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { ebooksUrls } from "../contracts/ebooks";
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
  /** The Genres cell of a book's table row, a chip editor once clicked. */
  genresCell(slug: string): Locator {
    return this.table.cell(slug, "genres");
  }

  /** The chip editor an open Genres cell shows. */
  genresCellInput(slug: string): Locator {
    return this.table.cellInput(slug, "genres");
  }

  async openGenresCell(slug: string): Promise<void> {
    await this.genresCell(slug).click();
  }

  async typeGenreInCell(slug: string, genre: string): Promise<void> {
    await this.genresCellInput(slug).fill(genre);
  }

  /** Commits the typed genre with Enter; a test that asserts the write wraps it. */
  async commitGenreInCell(slug: string): Promise<void> {
    await this.genresCellInput(slug).press("Enter");
  }

  /** Leaves the cell's editor with Escape, saving nothing. */
  async closeGenresCell(slug: string): Promise<void> {
    await this.genresCellInput(slug).press("Escape");
  }

  /** The palette's rows for genres, whose click refines the search to one. */
  get paletteGenreRows(): Locator {
    return this.topNav.searchPalette.row("genre");
  }

  async refineToPaletteGenre(): Promise<void> {
    await this.paletteGenreRows.click();
  }

  /** The text of every book row the palette lists. */
  async paletteBookRowTexts(): Promise<string[]> {
    return this.topNav.searchPalette.row("book").allInnerTexts();
  }
  // #endregion batch-E

  // #region batch-F: landing and add books
  readonly bulkEditBar = new BulkEditBarComponent(this.page);
  readonly bulkEditModal = new BulkEditModalComponent(this.page);
  readonly seriesCap = new SeriesCapComponent(this.page);
  readonly tabBar = new TabBarComponent(this.page);
  readonly addBooksSheet = new AddBooksSheetComponent(this.page);

  readonly libraryHeading = this.page.getByRole("heading", {
    level: 1,
    name: "Your Library",
  });
  readonly grid = this.page.getByTestId("lib-grid");
  readonly toolbar = this.page.getByTestId("lib-toolbar");
  readonly shelfRow = this.page.getByTestId("shelf-gallery");
  readonly allBooksShelfTile = this.page.getByTestId("gallery-all-books");
  readonly newShelfButton = this.page.getByTestId("new-shelf");
  readonly shelfRowPrevButton = this.page.getByTestId("shelf-row-prev");
  readonly shelfRowNextButton = this.page.getByTestId("shelf-row-next");
  readonly gridViewButton = this.page.getByTestId("view-toggle-grid");
  readonly bookTiles = this.page.getByTestId(/^ebook-tile-/);
  readonly firstBookTile = this.bookTiles.first();
  readonly firstBookTileCaption = this.firstBookTile.locator(".lib-tile-cap");
  readonly loadMoreButton = this.page.getByTestId("lib-load-more");
  readonly sortSelect = this.page.getByTestId("lib-sort-select");
  readonly sortDirectionButton = this.page.getByTestId("lib-sort-dir");
  readonly stackToggle = this.page.getByRole("button", {
    name: "Stack series",
  });
  readonly stackTiles = this.page.getByTestId(/^series-stack-/);
  readonly stackError = this.page.getByTestId("lib-stack-error");

  /** A folded series, named as its button reads: `Pioneers, 5 books`. */
  seriesStack(label: string): Locator {
    return this.page.getByRole("button", { name: label });
  }

  /** The grid cell that holds a folded series. */
  stackCell(label: string): Locator {
    return this.grid
      .getByRole("listitem")
      .filter({ has: this.seriesStack(label) });
  }

  /** A book's grid tile, found by its fixture slug. */
  volumeTile(slug: string): Locator {
    return this.page.getByTestId(`ebook-tile-${slug}`);
  }

  sortOption(name: string): Locator {
    return this.sortSelect.getByRole("option", { name });
  }

  /** Opens the landing page and waits for its first fetches to settle. */
  async gotoSettled(): Promise<void> {
    await this.openAndSettle("/");
  }

  /** Returns once the server-rendered HTML arrives, before the client runs. */
  async gotoBeforeHydration(): Promise<void> {
    await this.page.goto("/", { waitUntil: "domcontentloaded" });
  }

  async switchToGrid(): Promise<void> {
    await this.gridViewButton.click();
  }

  async hoverFirstBookTile(): Promise<void> {
    await this.firstBookTile.hover();
  }

  async sortBy(value: string): Promise<void> {
    await this.sortSelect.selectOption(value);
  }

  async toggleSortDirection(): Promise<void> {
    await this.sortDirectionButton.click();
  }

  async toggleStackSeries(): Promise<void> {
    await this.stackToggle.click();
  }

  async openSeriesStack(label: string): Promise<void> {
    await this.seriesStack(label).click();
  }

  /** Clicks the page heading, a neutral spot well outside the table. */
  async clickAway(): Promise<void> {
    await this.libraryHeading.click();
  }

  /** Marks every grid cell, so a cell the diff re-creates loses its mark. */
  async markGridCells(): Promise<void> {
    await this.grid.evaluate((grid) => {
      for (const cell of grid.children) cell.setAttribute("data-e2e-kept", "");
    });
  }

  /** How many grid cells are new since `markGridCells`. */
  async countUnmarkedGridCells(): Promise<number> {
    return this.grid.evaluate(
      (grid) => grid.querySelectorAll(":scope > :not([data-e2e-kept])").length,
    );
  }

  /** How many of the wall's mount sweeps a folded series is still playing. */
  async sweepAnimationCount(label: string): Promise<number> {
    return this.seriesStack(label).evaluate(
      (stack) =>
        stack
          .getAnimations()
          .filter(
            (animation) =>
              animation instanceof CSSAnimation &&
              animation.animationName === "lib-sweep-in",
          ).length,
    );
  }

  /** The key of the grid cell holding a folded series, or null once dealt out. */
  async stackLeadKey(label: string): Promise<string | null> {
    return this.page.evaluate(
      (name) =>
        document
          .querySelector(`[aria-label="${name}"]`)
          ?.closest("[data-flip-key]")
          ?.getAttribute("data-flip-key") ?? null,
      label,
    );
  }
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
  readonly sortLockedNote = this.page.getByTestId("lib-sort-locked");
  readonly titleColumnHeader = this.page.getByRole("columnheader", {
    name: /Title/,
  });
  readonly titleSortButton = this.titleColumnHeader.getByRole("button");
  readonly navShelvesLink = this.page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Shelves" });

  private releaseHeldShelfReads: (() => void) | undefined;

  tableRowCount(): Promise<number> {
    return this.table.rows.count();
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
  readonly filterBar = new FilterBarComponent(this.page);

  readonly loading = this.page.getByTestId("lib-loading");
  readonly emptyLibraryMessage = this.page.getByTestId("lib-empty");
  readonly noMatchesMessage = this.page.getByText(
    "No books match these filters.",
  );
  readonly clearFiltersButton = this.page.getByRole("button", {
    name: "Clear filters",
  });

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
