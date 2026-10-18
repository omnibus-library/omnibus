import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The sheet the phone's centre action opens, with a row per way to add a book. */
export class AddBooksSheetComponent extends BaseComponent {
  readonly root: Locator;
  readonly scrim: Locator;
  readonly rows: Locator;
  readonly scanRow: Locator;
  readonly uploadRow: Locator;
  readonly uploadOffer: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("add-books-sheet");
    this.scrim = page.getByTestId("add-books-sheet-scrim");
    this.rows = page.getByTestId("add-books-row");
    this.scanRow = this.rows.filter({ hasText: "Scan a barcode" });
    this.uploadRow = this.rows.filter({ hasText: "Upload a file" });
    this.uploadOffer = page.getByText("Upload a file");
  }

  async chooseScan(): Promise<void> {
    await this.scanRow.click();
  }

  async chooseUpload(): Promise<void> {
    await this.uploadRow.click();
  }

  async dismissByScrim(): Promise<void> {
    // The top-left corner is scrim, well outside the sheet's body.
    await this.scrim.click({ position: { x: 8, y: 8 } });
  }
}
