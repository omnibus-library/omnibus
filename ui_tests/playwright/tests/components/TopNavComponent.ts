import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { BaseComponent } from "./BaseComponent";
import { SearchPaletteComponent } from "./SearchPaletteComponent";

/** The primary navigation bar along the top of every web page. */
export class TopNavComponent extends BaseComponent {
  readonly root: Locator;
  readonly libraryLink: Locator;
  readonly checkInButton: Locator;
  readonly userMenuButton: Locator;
  readonly userMenuPanel: Locator;
  readonly searchButton: Locator;
  readonly searchPalette: SearchPaletteComponent;

  constructor(page: Page) {
    super(page);
    this.root = page.getByRole("navigation", { name: "Primary" });
    this.libraryLink = this.root.getByRole("link", { name: "Library" });
    this.checkInButton = this.root.getByRole("button", {
      name: "Check in",
      exact: true,
    });
    this.userMenuButton = this.root.getByTestId("user-menu-trigger");
    this.userMenuPanel = page.getByTestId("user-menu-panel");
    this.searchButton = page.getByTestId("search-trigger");
    this.searchPalette = new SearchPaletteComponent(page, this.searchButton);
  }

  async openCheckIn(): Promise<void> {
    await this.checkInButton.click();
  }

  async openUserMenu(): Promise<void> {
    await this.userMenuButton.click();
  }

  /** The nav check every layout test makes: the bar and its fixed entries. */
  async assertDisplayed(): Promise<void> {
    await expect(this.root).toBeVisible();
    await expect(this.libraryLink).toBeVisible();
    await expect(this.userMenuButton).toBeVisible();
  }

  // batch-K:
  async openStats(): Promise<void> {
    await this.root.getByRole("link", { name: "Stats" }).click();
  }
}
