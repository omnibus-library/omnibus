import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** One saved passage on the book detail page: where it sits, and its link. */
export class SavedPassageCardComponent extends BaseComponent {
  readonly metaText: Locator;
  readonly openLink: Locator;

  constructor(
    page: Page,
    readonly root: Locator,
  ) {
    super(page);
    this.metaText = root.getByTestId("highlight-meta");
    this.openLink = root.getByRole("link", { name: "open in book" });
  }

  async openInBook(): Promise<void> {
    await this.openLink.click();
  }
}
