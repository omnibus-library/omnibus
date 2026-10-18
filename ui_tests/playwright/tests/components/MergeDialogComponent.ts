import type { Locator, Page } from "@playwright/test";
import { mergeUrls } from "../contracts/merge";
import { expect } from "../fixtures/test";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** An admin's "Merge with…" dialog on a book page, and the toast after it. */
export class MergeDialogComponent extends BaseComponent {
  readonly openButton: Locator;
  readonly dialog: Locator;
  readonly searchField: Locator;
  readonly resultsHeading: Locator;
  private readonly firstCandidate: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;
  readonly errorAlert: Locator;
  readonly mergedToast: Locator;
  private readonly undoButton: Locator;

  constructor(page: Page) {
    super(page);
    this.openButton = page.getByTestId("merge-with");
    this.dialog = page.getByRole("dialog", { name: "Merge with another book" });
    this.searchField = page.getByTestId("merge-search");
    this.resultsHeading = page.getByText("matching title, author or series");
    this.firstCandidate = page.getByTestId("merge-candidate").first();
    this.confirmButton = page.getByTestId("merge-confirm");
    this.cancelButton = page.getByTestId("merge-cancel");
    this.errorAlert = page.getByRole("alert");
    this.mergedToast = page
      .getByRole("status")
      .filter({ hasText: "Books merged." });
    this.undoButton = page.getByTestId("merge-undo");
  }

  async open(): Promise<void> {
    await this.openButton.click();
  }

  async search(title: string): Promise<void> {
    await this.searchField.fill(title);
  }

  async pickFirstCandidate(): Promise<void> {
    await this.firstCandidate.click();
  }

  /** Opens the dialog, searches `title` and picks the first candidate once it lists. */
  async chooseSource(title: string): Promise<void> {
    await this.open();
    await this.search(title);
    await this.firstCandidate.waitFor();
    await this.pickFirstCandidate();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  async confirm(): Promise<void> {
    const merged = this.page.waitForResponse(isPostTo(mergeUrls.books));
    await this.confirmButton.click();
    await merged;
  }

  async undo(): Promise<void> {
    const undone = this.page.waitForResponse(isPostTo(mergeUrls.undo));
    await this.undoButton.click();
    await undone;
  }

  /** Checks a search listed candidates, under a heading naming what matched. */
  async assertCandidatesListed(): Promise<void> {
    // The list fills after the debounced search RPC returns.
    await expect(this.firstCandidate).toBeVisible();
    // The heading names whichever of the three fields matched, not all of them.
    await expect(this.resultsHeading).toBeVisible();
  }
}
