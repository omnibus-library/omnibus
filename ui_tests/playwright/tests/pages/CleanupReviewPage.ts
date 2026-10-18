import type { Locator, Page } from "@playwright/test";
import { cleanupUrls } from "../contracts/cleanup";
import type { CleanupKind, SuggestionCard } from "../data/cleanup";
import { recordRequests } from "../utils/api";
import { BasePage } from "./BasePage";

/**
 * The one-card-at-a-time review of a kind's suggestions. Its only way in is a
 * Review link in Administration › Cleanup, so its only entry of its own is
 * an old address that redirects here.
 */
export class CleanupReviewPage extends BasePage {
  protected readonly urlPattern = /\/admin\/cleanup\/[a-z_]+$/;

  readonly review: Locator;
  readonly kindline: Locator;
  readonly emptyMessage: Locator;
  readonly errorMessage: Locator;
  readonly card: Locator;
  readonly cardAction: Locator;
  readonly cardScanned: Locator;
  readonly cardProposed: Locator;
  readonly cardBooks: Locator;
  readonly proposalField: Locator;
  readonly editedTag: Locator;
  readonly progress: Locator;
  readonly tally: Locator;
  readonly tallyCounts: Locator;
  readonly acceptButton: Locator;
  readonly acceptEditedButton: Locator;
  readonly rejectButton: Locator;
  readonly skipButton: Locator;
  readonly undoBar: Locator;
  readonly undoButton: Locator;
  readonly undoneMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.review = page.getByTestId("cleanup-review");
    this.kindline = page.getByTestId("cleanup-kindline");
    this.emptyMessage = page.getByTestId("cleanup-review-empty");
    this.errorMessage = page.getByTestId("cleanup-review-error");
    this.card = page.getByTestId("cleanup-card");
    this.cardAction = page.getByTestId("cleanup-card-action");
    this.cardScanned = page.getByTestId("cleanup-card-scanned");
    this.cardProposed = page.getByTestId("cleanup-card-proposed");
    this.cardBooks = page.getByTestId("cleanup-card-books");
    this.proposalField = page.getByTestId("cleanup-proposed-input");
    this.editedTag = page.getByTestId("cleanup-edited-tag");
    this.progress = page.getByTestId("cleanup-progress");
    this.tally = page.getByTestId("cleanup-tally");
    this.tallyCounts = this.tally.locator(".crx-tally-n");
    this.acceptButton = page.getByRole("button", { name: "Accept (Y)" });
    this.acceptEditedButton = page.getByRole("button", {
      name: "Accept edited title (Y)",
    });
    this.rejectButton = page.getByRole("button", { name: "Reject (N)" });
    this.skipButton = page.getByRole("button", { name: "Skip (Space)" });
    this.undoBar = page.getByTestId("cleanup-undo-bar");
    this.undoButton = page.getByTestId("cleanup-undo");
    this.undoneMessage = page.getByTestId("cleanup-undone");
  }

  protected get readyLocator(): Locator {
    return this.review;
  }

  /** Opens an address that predates Administration, which redirects here. */
  async gotoLegacy(path: string): Promise<void> {
    await this.openAndSettle(path);
  }

  /** The page's title, such as "Review authors". */
  heading(title: string): Locator {
    return this.page.getByRole("heading", { level: 1, name: title });
  }

  /** The chip that switches the review to another kind. */
  kindChip(kind: CleanupKind): Locator {
    return this.page.getByTestId(`cleanup-kindchip-${kind}`);
  }

  async accept(): Promise<void> {
    await this.acceptButton.click();
  }

  async acceptEdited(): Promise<void> {
    await this.acceptEditedButton.click();
  }

  async reject(): Promise<void> {
    await this.rejectButton.click();
  }

  async skip(): Promise<void> {
    await this.skipButton.click();
  }

  async undo(): Promise<void> {
    await this.undoButton.click();
  }

  async acceptWithHotkey(): Promise<void> {
    await this.page.keyboard.press("y");
  }

  async pressSpace(): Promise<void> {
    await this.review.press("Space");
  }

  /** Replaces the proposal with `text` in one go. */
  async editProposal(text: string): Promise<void> {
    await this.proposalField.fill(text);
  }

  /** Types `text` key by key, as hotkeys would see it. */
  async typeProposal(text: string): Promise<void> {
    await this.proposalField.click();
    await this.proposalField.fill("");
    await this.proposalField.pressSequentially(text);
  }

  /**
   * Serves `cards` as the pending queue. The real one is server state that a
   * parallel reindex can refill, and accepting a real card would merge rows.
   */
  async stubQueue(cards: SuggestionCard[]): Promise<void> {
    await this.page.route(cleanupUrls.queue, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(cards),
      }),
    );
  }

  /**
   * Accepts any decision without writing it, since a canned card has no row.
   * `logId` is the `cleanup_log` row an undo would then name.
   */
  async stubDecisionsRecorded(logId: number | null = null): Promise<void> {
    await this.page.route(cleanupUrls.decide, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: String(logId),
      }),
    );
  }

  /** Accepts an undo without writing it, for the same canned card. */
  async stubUndoRecorded(): Promise<void> {
    await this.page.route(cleanupUrls.undo, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "null",
      }),
    );
  }

  /** The methods of every re-read of the kind counts from now on. */
  recordCountReads(): string[] {
    return recordRequests(this.page, cleanupUrls.counts);
  }
}
