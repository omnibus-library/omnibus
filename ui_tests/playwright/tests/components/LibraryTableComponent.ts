import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The landing library as a table, which the grid view replaces by default. */
export class LibraryTableComponent extends BaseComponent {
  readonly root: Locator;
  readonly viewToggleButton: Locator;
  readonly rows: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("ebook-table");
    this.viewToggleButton = page.getByTestId("view-toggle-table");
    this.rows = page.getByTestId(/^ebook-row-/);
  }

  /** A book's row, found by its fixture slug. */
  row(slug: string): Locator {
    return this.page.getByTestId(`ebook-row-${slug}`);
  }

  /** One cell of a book's row; `column` is `title`, `author`, `genres`, … */
  cell(slug: string, column: string): Locator {
    return this.row(slug).getByTestId(`ebook-cell-${column}`);
  }

  /** The editor an editable cell opens when clicked. */
  cellInput(slug: string, column: string): Locator {
    return this.cell(slug, column).getByTestId(`ebook-cell-${column}-input`);
  }

  /** The suggestion dropdown under a chip cell's editor. */
  cellSuggestions(slug: string, column: string): Locator {
    return this.cell(slug, column).getByTestId(
      `ebook-cell-${column}-suggestions`,
    );
  }

  async switchTo(): Promise<void> {
    await this.viewToggleButton.click();
    await this.root.waitFor();
  }
}
