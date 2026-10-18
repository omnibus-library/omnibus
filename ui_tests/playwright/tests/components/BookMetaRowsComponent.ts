import type { Locator } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The label and value rows of the book page's details table. */
export class BookMetaRowsComponent extends BaseComponent {
  /** The value beside `label`, such as `Added`. */
  value(label: string): Locator {
    const labelCell = this.page.locator(".bd-meta-k", {
      hasText: new RegExp(`^${label}$`),
    });
    return this.page
      .locator("tr.bd-meta-row")
      .filter({ has: labelCell })
      .locator(".bd-meta-v");
  }
}
