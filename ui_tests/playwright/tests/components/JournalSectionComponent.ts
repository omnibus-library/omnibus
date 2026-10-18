import type { Locator, Page } from "@playwright/test";
import { journalsUrls } from "../contracts/journals";
import { expect } from "../fixtures/test";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";
import { JournalEntryOverlayComponent } from "./JournalEntryOverlayComponent";

/** The book page's journal stop: the feed of entries and the composer over it. */
export class JournalSectionComponent extends BaseComponent {
  readonly section: Locator;
  readonly kicker: Locator;
  readonly newEntryButton: Locator;
  readonly draftChipRow: Locator;

  readonly composer: Locator;
  readonly composerError: Locator;
  readonly editor: Locator;
  readonly editorLines: Locator;
  /** The hidden textarea that mirrors the editor's markdown. */
  readonly markdown: Locator;
  readonly spoilerHelp: Locator;
  readonly toolbar: Locator;
  readonly boldButton: Locator;
  private readonly quoteButton: Locator;
  readonly insertHighlightButton: Locator;
  readonly highlightsPopover: Locator;
  private readonly previewToggle: Locator;
  readonly previewBold: Locator;
  readonly autosavedNote: Locator;
  private readonly imageInput: Locator;
  private readonly publishButton: Locator;
  private readonly saveDraftButton: Locator;
  private readonly cancelButton: Locator;

  private readonly entry: JournalEntryOverlayComponent;

  constructor(page: Page) {
    super(page);
    this.entry = new JournalEntryOverlayComponent(page);
    this.section = page.getByTestId("journal-section");
    this.kicker = page.getByTestId("journal-kicker");
    this.newEntryButton = page.getByTestId("journal-open-composer");
    this.draftChipRow = page.getByTestId("journal-draft-chip-row").first();

    this.composer = page.getByTestId("journal-composer");
    this.composerError = this.composer.getByRole("alert");
    this.editor = page.getByTestId("journal-editor");
    this.editorLines = this.editor.locator(".cm-line");
    this.markdown = page.getByTestId("journal-body");
    this.spoilerHelp = page.getByTestId("journal-spoiler-help");
    this.toolbar = page.getByTestId("journal-toolbar");
    this.boldButton = this.toolbar.getByRole("button", { name: "Bold" });
    this.quoteButton = this.toolbar.getByRole("button", { name: "Quote" });
    this.insertHighlightButton = page.getByTestId("journal-insert-highlight");
    this.highlightsPopover = page.getByTestId("journal-highlights-pop");
    this.previewToggle = page.getByTestId("journal-preview-toggle");
    this.previewBold = page.getByTestId("journal-preview").locator("strong");
    this.autosavedNote = page.getByTestId("journal-autosaved");
    this.imageInput = page.getByTestId("journal-image-input").first();
    this.publishButton = page.getByTestId("journal-publish");
    this.saveDraftButton = page.getByTestId("journal-save-draft");
    this.cancelButton = page.getByRole("button", { name: "Cancel" });
  }

  /** The feed row whose excerpt contains `marker`. */
  ladderRow(marker: string): Locator {
    return this.page
      .getByTestId("journal-ladder-row")
      .filter({ hasText: marker });
  }

  editorLine(index: number): Locator {
    return this.editorLines.nth(index);
  }

  /** The first markdown marker on line `index`, which fades with the caret. */
  lineMarker(index: number): Locator {
    return this.editorLine(index).locator(".cm-mark").first();
  }

  /** The highlight in the inserter whose quote contains `quote`. */
  highlightItem(quote: string): Locator {
    return this.page
      .getByTestId("journal-highlight-item")
      .filter({ hasText: quote });
  }

  async openComposer(): Promise<void> {
    await this.newEntryButton.click();
  }

  async write(text: string): Promise<void> {
    await this.editor.fill(text);
  }

  /** Types through the keyboard, so `\n` presses Enter like a real author. */
  async type(text: string): Promise<void> {
    await this.editor.click();
    await this.page.keyboard.type(text);
  }

  /** Types each line on its own, pressing Enter between them. */
  async typeLines(lines: string[]): Promise<void> {
    await this.editor.click();
    for (const [index, line] of lines.entries()) {
      if (index > 0) await this.editor.press("Enter");
      await this.editor.pressSequentially(line);
    }
  }

  /** Types at the caret, which `write` would replace the draft instead of. */
  async typeAtCaret(text: string): Promise<void> {
    await this.editor.pressSequentially(text);
  }

  async press(keys: string): Promise<void> {
    await this.editor.press(keys);
  }

  async selectText(): Promise<void> {
    await this.editor.selectText();
  }

  async focusLine(index: number): Promise<void> {
    await this.editorLine(index).click();
  }

  async bold(): Promise<void> {
    await this.boldButton.click();
  }

  async quote(): Promise<void> {
    await this.quoteButton.click();
  }

  async openHighlightInserter(): Promise<void> {
    await this.insertHighlightButton.click();
  }

  async insertHighlight(quote: string): Promise<void> {
    await this.highlightItem(quote).click();
  }

  /** Opens the composer, writes `body` and publishes it. */
  async publishEntry(body: string): Promise<void> {
    await this.openComposer();
    await this.write(body);
    await this.publish();
  }

  async publish(): Promise<void> {
    await this.clickAndAwait(this.publishButton, journalsUrls.save);
  }

  async saveDraft(): Promise<void> {
    await this.clickAndAwait(this.saveDraftButton, journalsUrls.save);
  }

  /** Cancels the composer, which deletes the draft the autosave created. */
  async discardDraft(): Promise<void> {
    await this.clickAndAwait(this.cancelButton, journalsUrls.delete);
  }

  async togglePreview(): Promise<void> {
    await this.clickAndAwait(this.previewToggle, journalsUrls.preview);
  }

  /** Picks `png` in the toolbar's file input, which uploads it. */
  async uploadImage(png: Buffer): Promise<void> {
    const uploaded = this.page.waitForResponse(isPostTo(journalsUrls.images));
    await this.imageInput.setInputFiles({
      name: "figure.png",
      mimeType: "image/png",
      buffer: png,
    });
    await uploaded;
  }

  /** Opens the feed row for `marker` in the overlay and waits for its card. */
  async openEntry(marker: string): Promise<void> {
    await this.ladderRow(marker).click();
    await this.entry.entryWithText(marker).waitFor();
  }

  async scrollRowIntoView(marker: string): Promise<void> {
    await this.ladderRow(marker).scrollIntoViewIfNeeded();
  }

  /** How far the book page's flow scroller has scrolled; 0 without one. */
  flowScrollTop(): Promise<number> {
    return this.page.evaluate(
      () => document.querySelector("#bdmq-flow")?.scrollTop ?? 0,
    );
  }

  /** The text of the selection the page holds, which is empty when collapsed. */
  selectedText(): Promise<string | undefined> {
    return this.page.evaluate(() => window.getSelection()?.toString());
  }

  /** The text painted over line `index`'s list marker, or `none`. */
  listMarkerContent(index: number): Promise<string> {
    return this.editorLine(index)
      .locator(".cm-list, .cm-task")
      .first()
      .evaluate((el) => getComputedStyle(el, "::before").content);
  }

  /** Checks the 2s autosave landed, so a draft row exists to discard. */
  async assertAutosaved(): Promise<void> {
    await expect(this.autosavedNote).toContainText("Auto-saved", {
      timeout: 10_000,
    });
  }

  private async clickAndAwait(button: Locator, url: RegExp): Promise<void> {
    const responded = this.page.waitForResponse(isPostTo(url));
    await button.click();
    await responded;
  }
}
