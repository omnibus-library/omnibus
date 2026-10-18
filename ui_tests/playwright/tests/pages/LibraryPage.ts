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
import { PageScrollComponent } from "../components/PageScrollComponent";
import { SeriesCapComponent } from "../components/SeriesCapComponent";
import { ShelfGalleryComponent } from "../components/ShelfGalleryComponent";
import { TabBarComponent } from "../components/TabBarComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { ebooksUrls } from "../contracts/ebooks";
import { thumbsUrls } from "../contracts/thumbs";
import type { ShelfRef } from "../data/shelves";
import { expect } from "../fixtures/test";
import { holdRequests } from "../utils/api";
import { BasePage } from "./BasePage";

export class LibraryPage extends BasePage {
  protected readonly urlPattern = /\/$/;

  readonly topNav: TopNavComponent;
  readonly checkInOverlay: CheckInOverlayComponent;
  readonly table: LibraryTableComponent;
  readonly continueStack: ContinueStackComponent;
  readonly bulkEditBar: BulkEditBarComponent;
  readonly bulkEditModal: BulkEditModalComponent;
  readonly seriesCap: SeriesCapComponent;
  readonly tabBar: TabBarComponent;
  readonly addBooksSheet: AddBooksSheetComponent;
  readonly shelfGallery: ShelfGalleryComponent;
  readonly createShelfModal: CreateShelfModalComponent;
  readonly editShelfModal: EditShelfModalComponent;
  readonly addBooksModal: AddBooksModalComponent;
  readonly filterBar: FilterBarComponent;
  readonly scroll: PageScrollComponent;

  readonly titleHeading: Locator;
  readonly sectionTitle: Locator;
  readonly libraryHeading: Locator;
  readonly grid: Locator;
  readonly toolbar: Locator;
  readonly gridViewButton: Locator;
  readonly bookTiles: Locator;
  readonly firstBookTile: Locator;
  readonly firstCover: Locator;
  readonly firstBookTileCaption: Locator;
  readonly loadMoreButton: Locator;
  readonly sortSelect: Locator;
  readonly sortDirectionButton: Locator;
  readonly stackToggle: Locator;
  readonly stackTiles: Locator;
  readonly stackError: Locator;
  readonly shelfEditButton: Locator;
  readonly shelfAddBooksButton: Locator;
  readonly shelfAddBooksTile: Locator;
  readonly shelfFacets: Locator;
  readonly lastBookGridItem: Locator;
  readonly emptyMessage: Locator;
  readonly pageError: Locator;
  readonly sortLockedNote: Locator;
  /** The landing's "· N hidden" receipt, shown when the reader hides a format. */
  readonly hiddenReceipt: Locator;
  /** The note naming the hidden formats, which links to the preference that hides them. */
  readonly hiddenNote: Locator;
  readonly loading: Locator;
  readonly noMatchesMessage: Locator;
  readonly clearFiltersButton: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.checkInOverlay = new CheckInOverlayComponent(page);
    this.table = new LibraryTableComponent(page);
    this.continueStack = new ContinueStackComponent(page);
    this.bulkEditBar = new BulkEditBarComponent(page);
    this.bulkEditModal = new BulkEditModalComponent(page);
    this.seriesCap = new SeriesCapComponent(page);
    this.tabBar = new TabBarComponent(page);
    this.addBooksSheet = new AddBooksSheetComponent(page);
    this.shelfGallery = new ShelfGalleryComponent(page);
    this.createShelfModal = new CreateShelfModalComponent(page);
    this.editShelfModal = new EditShelfModalComponent(page);
    this.addBooksModal = new AddBooksModalComponent(page);
    this.filterBar = new FilterBarComponent(page);
    this.scroll = new PageScrollComponent(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.sectionTitle = page.getByTestId("lib-section-title");
    this.libraryHeading = page.getByRole("heading", {
      level: 1,
      name: "Your Library",
    });
    this.grid = page.getByTestId("lib-grid");
    this.toolbar = page.getByTestId("lib-toolbar");
    this.gridViewButton = page.getByTestId("view-toggle-grid");
    this.bookTiles = page.getByTestId(/^ebook-tile-/);
    this.firstBookTile = this.bookTiles.first();
    this.firstCover = this.grid
      .getByRole("img", { name: /^Cover of / })
      .first();
    this.firstBookTileCaption = this.firstBookTile.locator(".lib-tile-cap");
    this.loadMoreButton = page.getByTestId("lib-load-more");
    this.sortSelect = page.getByTestId("lib-sort-select");
    this.sortDirectionButton = page.getByTestId("lib-sort-dir");
    this.stackToggle = page.getByRole("button", { name: "Stack series" });
    this.stackTiles = page.getByTestId(/^series-stack-/);
    this.stackError = page.getByTestId("lib-stack-error");
    this.shelfEditButton = page.getByTestId("shelf-edit");
    this.shelfAddBooksButton = page.getByTestId("shelf-add-books");
    this.shelfAddBooksTile = page.getByTestId("shelf-add-tile");
    this.shelfFacets = page.getByTestId("shelf-facets");
    this.lastBookGridItem = this.grid.locator(":scope > *").last();
    this.emptyMessage = page.getByTestId("lib-empty");
    this.pageError = page.getByTestId("lib-page-error");
    this.sortLockedNote = page.getByTestId("lib-sort-locked");
    this.hiddenReceipt = page.getByTestId("lib-hidden-count");
    this.hiddenNote = page.getByTestId("lib-hidden-formats");
    this.loading = page.getByTestId("lib-loading");
    this.noMatchesMessage = page.getByText("No books match these filters.");
    this.clearFiltersButton = page.getByRole("button", {
      name: "Clear filters",
    });
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
  async goto(): Promise<void> {
    await this.openAndSettle("/");
  }

  /** Opens the landing page without waiting for its fetches, which a hold keeps from settling. */
  async gotoUnsettled(): Promise<void> {
    await this.open("/");
  }

  /** Filters the book list to `shelf` in place; the page does not navigate. */
  async selectShelf(shelf: ShelfRef): Promise<void> {
    await this.galleryShelfTile(shelf.id).click();
    await this.sectionTitle.filter({ hasText: shelf.name }).waitFor();
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

  /** Follows the hidden-formats note to the preference that hides them. */
  async openHiddenFormatsNote(): Promise<void> {
    await this.hiddenNote.click();
  }

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

  /** Parks every thumbnail, so a cover can be seen mid-load; the release lets them through. */
  async holdThumbnails(): Promise<() => Promise<void>> {
    const release = await holdRequests(this.page, thumbsUrls.any);
    return async () => {
      release();
      await this.page.unrouteAll({ behavior: "wait" });
    };
  }

  async clearFilters(): Promise<void> {
    await this.clearFiltersButton.click();
  }

  /** The slugs of the book tiles on the grid, sorted. */
  async tileSlugs(): Promise<string[]> {
    return this.bookTiles.evaluateAll((tiles) =>
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

  /** The titles on the grid tiles, in the order they are painted. */
  tileTitles(): Promise<string[]> {
    return this.page.locator(".lib-tile-title").allTextContents();
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

  /** Opens a book's detail from its grid tile, a client-side hop. */
  async openBook(title: string): Promise<void> {
    await this.bookTile(title).click();
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
          await this.goto();
          return this.continueStack.card(bookUuid).count();
        },
        {
          timeout: 30_000,
          message: `book ${bookUuid} never reached the continue-reading stack`,
        },
      )
      .toBeGreaterThan(0);
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
}
