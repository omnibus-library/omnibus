import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The landing page's row of shelf tiles, with All Books first. */
export class ShelfGalleryComponent extends BaseComponent {
  readonly root: Locator;
  readonly allBooksTile: Locator;
  /** The All Books tab's count, absent until the list has answered. */
  readonly allBooksCount: Locator;
  /** The tab whose books the list below shows. */
  readonly selectedTab: Locator;
  readonly allShelvesLink: Locator;
  readonly newShelfButton: Locator;
  readonly row: Locator;
  readonly previousArrow: Locator;
  readonly nextArrow: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("shelf-gallery");
    this.allBooksTile = page.getByTestId("gallery-all-books");
    this.allBooksCount = page.getByTestId("gallery-all-books-count");
    this.allShelvesLink = page.getByTestId("gallery-all-shelves");
    this.newShelfButton = page.getByTestId("new-shelf");
    this.row = this.root.locator("#lmq-shelf-row");
    this.previousArrow = page.getByTestId("shelf-row-prev");
    this.nextArrow = page.getByTestId("shelf-row-next");
    this.selectedTab = this.row.getByRole("button", { pressed: true });
  }

  async selectAllBooks(): Promise<void> {
    await this.allBooksTile.click();
  }

  async openAllShelves(): Promise<void> {
    await this.allShelvesLink.click();
  }

  async openNewShelf(): Promise<void> {
    await this.newShelfButton.click();
  }

  async pageForward(): Promise<void> {
    await this.nextArrow.click();
  }

  async pageBack(): Promise<void> {
    await this.previousArrow.click();
  }

  /** The All Books tab's count, read once the list has answered. */
  async allBooksTotal(): Promise<number> {
    return Number((await this.allBooksCount.textContent()) ?? Number.NaN);
  }

  /** How far the row has scrolled from its left end. */
  scrollLeft(): Promise<number> {
    return this.row.evaluate((row) => row.scrollLeft);
  }
}
