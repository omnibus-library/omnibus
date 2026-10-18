import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The command palette, opened from the top nav's search button. */
export class SearchPaletteComponent extends BaseComponent {
  readonly panel: Locator;
  readonly input: Locator;

  constructor(
    page: Page,
    private readonly searchButton: Locator,
  ) {
    super(page);
    this.panel = page.getByTestId("sp-panel");
    this.input = page.getByTestId("sp-input");
  }

  /** The palette's result rows of one `kind`, such as `book` or `genre`. */
  row(kind: string): Locator {
    return this.page.getByTestId(`sp-${kind}-row`);
  }

  async open(): Promise<void> {
    await this.searchButton.click();
    await this.input.waitFor();
  }

  async search(query: string): Promise<void> {
    await this.open();
    await this.input.fill(query);
  }
}
