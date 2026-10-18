import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures/test";
import { BaseComponent } from "./BaseComponent";

/** The primary navigation bar along the top of every web page. */
export class TopNavComponent extends BaseComponent {
  readonly root: Locator;
  readonly libraryLink: Locator;
  readonly checkInButton: Locator;
  readonly userMenuButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByRole("navigation", { name: "Primary" });
    this.libraryLink = this.root.getByRole("link", { name: "Library" });
    this.checkInButton = this.root.getByRole("button", {
      name: "Check in",
      exact: true,
    });
    this.userMenuButton = this.root.getByTestId("user-menu-trigger");
  }

  async openCheckIn(): Promise<void> {
    await this.checkInButton.click();
  }

  async openLibrary(): Promise<void> {
    await this.libraryLink.click();
  }

  /** The nav check every layout test makes: the bar and its fixed entries. */
  async assertDisplayed(): Promise<void> {
    await expect(this.root).toBeVisible();
    await expect(this.libraryLink).toBeVisible();
    await expect(this.userMenuButton).toBeVisible();
  }
}
