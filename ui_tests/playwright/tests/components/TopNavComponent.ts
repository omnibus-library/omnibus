import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The primary navigation bar along the top of every web page. */
export class TopNavComponent extends BaseComponent {
  readonly root: Locator;
  readonly checkInButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByRole("navigation", { name: "Primary" });
    this.checkInButton = this.root.getByRole("button", {
      name: "Check in",
      exact: true,
    });
  }

  async openCheckIn(): Promise<void> {
    await this.checkInButton.click();
  }
}
