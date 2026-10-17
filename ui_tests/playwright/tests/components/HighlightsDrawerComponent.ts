import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The highlights drawer: every highlight and note the reader made. */
export class HighlightsDrawerComponent extends BaseComponent {
  readonly root: Locator;
  readonly emptyMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("reader-highlights-drawer");
    this.emptyMessage = this.root.getByText("No highlights yet");
  }
}
