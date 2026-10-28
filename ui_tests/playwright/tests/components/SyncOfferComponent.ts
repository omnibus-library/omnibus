import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The offer the reader and player show with follow off: where the other format got to, Go, and a dismiss. */
export class SyncOfferComponent extends BaseComponent {
  // A test id: specs assert it absent, and its copy turns with direction.
  readonly root: Locator;
  readonly goButton: Locator;
  readonly dismissButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("sync-offer");
    this.goButton = this.root.getByRole("button", { name: "Go", exact: true });
    this.dismissButton = this.root.getByRole("button", { name: "Dismiss" });
  }

  async go(): Promise<void> {
    await this.goButton.click();
  }

  async dismiss(): Promise<void> {
    await this.dismissButton.click();
  }
}
