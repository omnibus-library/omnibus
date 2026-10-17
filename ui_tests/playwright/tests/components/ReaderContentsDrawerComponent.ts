import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The contents drawer: the book's table of contents, one button per entry. */
export class ReaderContentsDrawerComponent extends BaseComponent {
  readonly root: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("reader-toc-drawer");
  }
}
