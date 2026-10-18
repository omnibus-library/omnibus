import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";
import { ShelfPickerComponent } from "./ShelfPickerComponent";

/** The floating bar over the table's selected rows, with the picker it opens. */
export class BulkEditBarComponent extends BaseComponent {
  readonly shelfPicker: ShelfPickerComponent;

  readonly root: Locator;
  readonly clearButton: Locator;
  readonly editButton: Locator;
  readonly addToShelfButton: Locator;

  constructor(page: Page) {
    super(page);
    this.shelfPicker = new ShelfPickerComponent(page);
    this.root = page.getByTestId("bulk-edit-bar");
    this.clearButton = page.getByTestId("bulk-edit-clear");
    this.editButton = page.getByTestId("bulk-edit-open");
    this.addToShelfButton = page.getByTestId("bulk-add-to-shelf");
  }

  /** The bar's CSS `position`, which stays `fixed` only if its rule wins. */
  async position(): Promise<string> {
    return this.root.evaluate((bar) => getComputedStyle(bar).position);
  }

  async clear(): Promise<void> {
    await this.clearButton.click();
  }

  async openEditor(): Promise<void> {
    await this.editButton.click();
  }

  async openShelfPicker(): Promise<void> {
    await this.addToShelfButton.click();
  }

  /** Files the selection on the shelf named `name`, from the open picker. */
  async chooseShelf(name: string): Promise<void> {
    await this.shelfPicker.shelfButton(name).click();
  }

  async closeShelfPicker(): Promise<void> {
    await this.shelfPicker.closeButton.click();
  }
}
