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

  // batch-C:
  get noteText(): Locator {
    return this.root.getByTestId("highlight-note");
  }

  get deleteButton(): Locator {
    return this.root.getByTestId("highlight-delete");
  }

  get quoteButton(): Locator {
    return this.root.getByTestId("highlight-quote");
  }

  async delete(): Promise<void> {
    await this.deleteButton.click();
  }

  async openQuoteCard(): Promise<void> {
    await this.quoteButton.click();
  }

  /** The reader path and cfi the link points at, resolved against this page. */
  async openTarget(): Promise<{ pathname: string; cfi: string | null }> {
    const href = await this.openLink.getAttribute("href");
    if (href === null) throw new Error("the open in book link has no href");
    const target = new URL(href, this.page.url());
    return { pathname: target.pathname, cfi: target.searchParams.get("cfi") };
  }
}
