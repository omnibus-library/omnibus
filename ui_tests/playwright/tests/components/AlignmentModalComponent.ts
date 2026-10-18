import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The modal where a reader confirms how a book's ebook and audio line up. */
export class AlignmentModalComponent extends BaseComponent {
  readonly root: Locator;
  readonly lanes: Locator;
  readonly narrationChoice: Locator;
  readonly lowConfidenceNote: Locator;
  readonly percentagePill: Locator;
  readonly syncStaysOffNote: Locator;
  readonly confirmButton: Locator;
  readonly unlinkButton: Locator;
  readonly cancelButton: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("alignment-modal");
    this.lanes = page.getByTestId("alignment-lanes");
    this.narrationChoice = page.getByTestId("alignment-choice");
    this.lowConfidenceNote = page.getByTestId("alignment-lowconf");
    this.percentagePill = page.getByTestId("alignment-linear-pill");
    this.syncStaysOffNote = page.getByText("Sync stays off until you confirm");
    this.confirmButton = page.getByTestId("alignment-confirm");
    this.unlinkButton = page.getByTestId("alignment-unlink");
    this.cancelButton = page.getByTestId("alignment-cancel");
    this.errorAlert = page.getByRole("alert");
  }

  async confirm(): Promise<void> {
    await this.confirmButton.click();
  }

  async unlink(): Promise<void> {
    await this.unlinkButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }
}
