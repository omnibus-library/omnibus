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
    this.root = page.getByRole("region", { name: "Shelves" });
    this.allBooksTile = this.root.getByRole("button", { name: /^All Books, / });
    this.allBooksCount = this.allBooksTile.locator(".lmq-shent-meta");
    this.allShelvesLink = this.root.getByRole("link", { name: "All shelves" });
    this.newShelfButton = page.getByTestId("new-shelf");
    this.row = this.root.locator("#lmq-shelf-row");
    this.previousArrow = this.root.getByRole("button", {
      name: "Earlier shelves",
    });
    this.nextArrow = this.root.getByRole("button", { name: "More shelves" });
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

  /** How far the row has scrolled from its left end. */
  scrollLeft(): Promise<number> {
    return this.row.evaluate((row) => row.scrollLeft);
  }
}
