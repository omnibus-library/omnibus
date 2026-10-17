import type { Locator, Page } from "@playwright/test";
import { highlightsUrls } from "../contracts/highlights";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";
import { HighlightRowComponent } from "./HighlightRowComponent";

/** The highlights drawer, and the note composer that opens over it. */
export class HighlightsDrawerComponent extends BaseComponent {
  readonly root: Locator;
  readonly emptyMessage: Locator;
  readonly noteComposerPanel: Locator;
  readonly noteField: Locator;
  readonly saveNoteButton: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("reader-highlights-drawer");
    this.emptyMessage = this.root.getByText("No highlights yet");
    this.noteComposerPanel = page.getByTestId("reader-note-composer");
    this.noteField = this.noteComposerPanel.getByTestId("reader-note-input");
    this.saveNoteButton =
      this.noteComposerPanel.getByTestId("reader-note-save");
  }

  /** The row of the highlight whose quote contains `quote`. */
  row(quote: string): HighlightRowComponent {
    return new HighlightRowComponent(
      this.page,
      this.root.getByTestId("reader-highlight-row").filter({ hasText: quote }),
    );
  }

  /** The quote wherever it shows on the page, not only in the drawer. */
  quoteText(quote: string): Locator {
    return this.page.getByText(quote);
  }

  async enterNote(note: string): Promise<void> {
    await this.noteField.fill(note);
  }

  async saveNote(): Promise<void> {
    const saved = this.page.waitForResponse(
      isPostTo(highlightsUrls.updateNote),
    );
    await this.saveNoteButton.click();
    await saved;
  }
}
