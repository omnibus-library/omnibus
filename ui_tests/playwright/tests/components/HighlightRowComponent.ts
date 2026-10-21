import type { Locator, Page } from "@playwright/test";
import { highlightsUrls } from "../contracts/highlights";
import type { HighlightColor } from "../data/highlights";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** One highlight in the highlights drawer: its note, colors and delete. */
export class HighlightRowComponent extends BaseComponent {
  readonly noteButton: Locator;
  readonly deleteButton: Locator;

  constructor(
    page: Page,
    readonly root: Locator,
  ) {
    super(page);
    this.noteButton = root.getByTestId("highlight-note");
    this.deleteButton = root.getByTestId("highlight-delete");
  }

  recolorButton(color: HighlightColor): Locator {
    return this.root.getByTestId(`reader-highlight-recolor-${color}`);
  }

  noteText(note: string): Locator {
    return this.root.getByText(note);
  }

  async openNoteComposer(): Promise<void> {
    await this.noteButton.click();
  }

  async delete(): Promise<void> {
    const deleted = this.page.waitForResponse(isPostTo(highlightsUrls.delete));
    await this.deleteButton.click();
    await deleted;
  }

  async recolor(color: HighlightColor): Promise<void> {
    const recolored = this.page.waitForResponse(
      isPostTo(highlightsUrls.updateColor),
    );
    await this.recolorButton(color).click();
    await recolored;
  }
}
