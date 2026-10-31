import type { Locator, Page } from "@playwright/test";
import { answers, highlightsUrls } from "../contracts/highlights";
import { BaseComponent } from "./BaseComponent";

/** One saved passage on the Highlights & Journal tab: its note, link and actions. */
export class SavedPassageCardComponent extends BaseComponent {
  readonly metaText: Locator;
  readonly noteText: Locator;
  readonly openLink: Locator;
  readonly quoteCardButton: Locator;
  readonly saveImageButton: Locator;
  readonly deleteButton: Locator;
  readonly deleteDialog: Locator;
  readonly deleteError: Locator;
  private readonly confirmDeleteButton: Locator;

  constructor(
    page: Page,
    readonly root: Locator,
  ) {
    super(page);
    this.metaText = root.getByTestId("highlight-meta");
    this.noteText = root.getByTestId("highlight-note");
    this.openLink = root.getByRole("link", { name: "Open in book" });
    // Turns the card over to its shareable face, where Save image… waits.
    this.quoteCardButton = root.getByRole("button", {
      name: "Make quote card",
    });
    this.saveImageButton = root.getByRole("button", { name: "Save image…" });
    this.deleteButton = root.getByRole("button", { name: "Delete highlight" });
    this.deleteDialog = page.getByTestId("highlight-delete-modal");
    this.deleteError = page.getByTestId("highlight-delete-error");
    this.confirmDeleteButton = page.getByTestId(
      "highlight-delete-modal-confirm",
    );
  }

  async openInBook(): Promise<void> {
    await this.openLink.click();
  }

  /** Turns the card over and opens the quote card editor from its back. */
  async openQuoteCard(): Promise<void> {
    await this.quoteCardButton.click();
    await this.saveImageButton.click();
  }

  /** Opens the delete confirm; nothing is deleted yet. */
  async startDelete(): Promise<void> {
    await this.deleteButton.click();
  }

  /** Confirms the delete and waits for the request to answer, whatever it says. */
  async confirmDelete(): Promise<void> {
    const deleted = this.page.waitForResponse(
      answers("DELETE", highlightsUrls.delete),
    );
    await this.confirmDeleteButton.click();
    await deleted;
  }

  /** Where "Open in book" leads, or null when the passage has no position. */
  async linkedPassage(): Promise<{ path: string; cfi: string | null } | null> {
    const href = await this.openLink.getAttribute("href");
    if (href === null) return null;
    const url = new URL(href, this.page.url());
    return { path: url.pathname, cfi: url.searchParams.get("cfi") };
  }
}
