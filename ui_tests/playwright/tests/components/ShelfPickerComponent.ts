import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The "Add to shelf" picker, opened from the book page or the bulk edit bar. */
export class ShelfPickerComponent extends BaseComponent {
  readonly root: Locator;
  readonly closeButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("shelf-picker");
    this.closeButton = page.getByTestId("shelf-picker-close");
    this.errorMessage = page.getByTestId("shelf-picker-error");
  }

  heading(name: string): Locator {
    return this.root.getByRole("heading", { name });
  }

  /** A hand-picked shelf's tile on the book page, a checkbox (see 04a). */
  shelf(name: string): Locator {
    return this.root.getByRole("checkbox", { name, exact: true });
  }

  /** A hand-picked shelf's tile in the bulk bar's picker, a plain button. */
  shelfButton(name: string): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }
}
