import type { Locator, Page } from "@playwright/test";
import { highlightsUrls } from "../contracts/highlights";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** One saved passage on the book detail page: its note, link and actions. */
export class SavedPassageCardComponent extends BaseComponent {
  readonly metaText: Locator;
  readonly noteText: Locator;
  readonly openLink: Locator;
  readonly quoteCardButton: Locator;
  readonly deleteButton: Locator;

  constructor(
    page: Page,
    readonly root: Locator,
  ) {
    super(page);
    this.metaText = root.getByTestId("highlight-meta");
    this.noteText = root.getByTestId("highlight-note");
    this.openLink = root.getByRole("link", { name: "open in book" });
    this.quoteCardButton = root.getByRole("button", { name: "quote card" });
    this.deleteButton = root.getByRole("button", {
      name: "delete",
      exact: true,
    });
  }

  async openInBook(): Promise<void> {
    await this.openLink.click();
  }

  async openQuoteCard(): Promise<void> {
    await this.quoteCardButton.click();
  }

  /** Clicks delete and waits for the request to answer, whatever it says. */
  async delete(): Promise<void> {
    const deleted = this.page.waitForResponse(isPostTo(highlightsUrls.delete));
    await this.deleteButton.click();
    await deleted;
  }

  /** Where "open in book" leads, or null when the passage has no position. */
  async linkedPassage(): Promise<{ path: string; cfi: string | null } | null> {
    const href = await this.openLink.getAttribute("href");
    if (href === null) return null;
    const url = new URL(href, this.page.url());
    return { path: url.pathname, cfi: url.searchParams.get("cfi") };
  }
}
