import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The contents drawer: the book's table of contents, one button per entry. */
export class ReaderContentsDrawerComponent extends BaseComponent {
  readonly root: Locator;
  readonly currentEntryButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("reader-toc-drawer");
    // Only a class marks the open chapter, not aria-current.
    this.currentEntryButton = this.root.locator(
      '[data-testid="reader-toc-row"].current',
    );
  }

  entryButton(label: string): Locator {
    return this.root.getByRole("button", { name: label, exact: true });
  }

  /** Clicks the entry only: the progress save follows once it renders. */
  async jumpTo(label: string): Promise<void> {
    await this.entryButton(label).click();
  }
}
