import type { Locator, Page } from "@playwright/test";
import { booksUrls } from "../contracts/books";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** An admin's "Delete files…" dialog on a book page: pick, confirm, delete. */
export class DeleteFilesDialogComponent extends BaseComponent {
  readonly openButton: Locator;
  readonly root: Locator;
  readonly fileCheckboxes: Locator;
  readonly selectAllBox: Locator;
  readonly continueButton: Locator;
  readonly confirmCopy: Locator;
  private readonly backButton: Locator;
  private readonly cancelButton: Locator;
  private readonly confirmButton: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.openButton = page.getByTestId("delete-files");
    this.root = page.getByTestId("delete-book-dialog");
    this.fileCheckboxes = this.root.getByRole("checkbox");
    this.selectAllBox = page.getByTestId("delete-select-all");
    this.continueButton = page.getByTestId("delete-continue");
    this.confirmCopy = page.getByTestId("delete-confirm-copy");
    this.backButton = page.getByTestId("delete-back");
    this.cancelButton = page.getByTestId("delete-cancel");
    this.confirmButton = page.getByTestId("delete-confirm");
    this.errorAlert = page.getByRole("alert");
  }

  async open(): Promise<void> {
    await this.openButton.click();
  }

  async selectAll(): Promise<void> {
    await this.selectAllBox.click();
  }

  async continueToConfirm(): Promise<void> {
    await this.continueButton.click();
  }

  async back(): Promise<void> {
    await this.backButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  async confirmDelete(): Promise<void> {
    const deleted = this.page.waitForResponse(isPostTo(booksUrls.deleteFiles));
    await this.confirmButton.click();
    await deleted;
  }
}
