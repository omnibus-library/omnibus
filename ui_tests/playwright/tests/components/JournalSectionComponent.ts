import type { Locator, Page, Response } from "@playwright/test";
import { journalsUrls } from "../contracts/journals";
import { expect } from "../fixtures/test";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";
import { JournalEntryCardComponent } from "./JournalEntryCardComponent";

/** A publish or Save draft: a create before any autosave, an update after one. */
const isEntrySave = (response: Response) => {
  const method = response.request().method();
  return (
    (method === "POST" && journalsUrls.create.test(response.url())) ||
    (method === "PATCH" && journalsUrls.entry.test(response.url()))
  );
};

/** The Highlights & Journal tab's journal: the feed of entries and the composer modal. */
export class JournalSectionComponent extends BaseComponent {
  /** The tab's two columns, or the one note it shows while both are empty. */
  readonly tab: Locator;
  readonly section: Locator;
  readonly newEntryButton: Locator;

  readonly composer: Locator;
  readonly composerError: Locator;
  readonly editor: Locator;
  readonly editorLines: Locator;
  readonly spoilerHelp: Locator;
  readonly toolbar: Locator;
  readonly boldButton: Locator;
  private readonly quoteButton: Locator;
  readonly insertHighlightButton: Locator;
  readonly highlightsPopover: Locator;
  private readonly previewToggle: Locator;
  private readonly writeTab: Locator;
  readonly previewBold: Locator;
  readonly autosavedNote: Locator;
  private readonly imageInput: Locator;
  private readonly publishButton: Locator;
  private readonly saveDraftButton: Locator;
  private readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.tab = page
      .getByTestId("highlights-journal")
      .or(page.getByTestId("highlights-journal-empty"));
    this.section = page.getByTestId("journal-section");
    // The feed's own button, or the tab's empty note's while nothing is in it.
    this.newEntryButton = page.getByTestId("journal-open-composer");

    this.composer = page.getByTestId("journal-composer");
    this.composerError = this.composer.getByRole("alert");
    this.editor = page.getByTestId("journal-editor");
    this.editorLines = this.editor.locator(".cm-line");
    this.spoilerHelp = page.getByTestId("journal-spoiler-help");
    this.toolbar = page.getByTestId("journal-toolbar");
    this.boldButton = this.toolbar.getByRole("button", { name: "Bold" });
    this.quoteButton = this.toolbar.getByRole("button", { name: "Quote" });
    this.insertHighlightButton = page.getByTestId("journal-insert-highlight");
    this.highlightsPopover = page.getByTestId("journal-highlights-pop");
    this.previewToggle = page.getByTestId("journal-preview-toggle");
    this.writeTab = this.composer.getByRole("button", {
      name: "Write",
      exact: true,
    });
    this.previewBold = page.getByTestId("journal-preview").locator("strong");
    this.autosavedNote = page.getByTestId("journal-autosaved");
    this.imageInput = this.composer.getByTestId("journal-image-input");
    this.publishButton = page.getByTestId("journal-publish");
    this.saveDraftButton = page.getByTestId("journal-save-draft");
    this.cancelButton = this.composer.getByRole("button", { name: "Cancel" });
  }

  /** The feed card whose entry contains `marker`. */
  entry(marker: string): JournalEntryCardComponent {
    return new JournalEntryCardComponent(this.page, this.entryCard(marker));
  }

  /** The feed card whose entry contains `marker`, as a locator. */
  entryCard(marker: string): Locator {
    return this.page.getByTestId("journal-entry").filter({ hasText: marker });
  }

  /** The editor's text, which is the draft's markdown character for character. */
  markdownSource(): Promise<string> {
    return this.editor.evaluate((el) => el.textContent ?? "");
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
    await this.clickAndAwait(this.publishButton, isEntrySave);
  }

  async saveDraft(): Promise<void> {
    await this.clickAndAwait(this.saveDraftButton, isEntrySave);
  }

  /** Closes a composer nothing was typed in, so no draft is written to delete. */
  async closeEmptyComposer(): Promise<void> {
    await this.cancelButton.click();
  }

  /** Cancels the composer, which deletes the draft the autosave created. */
  async discardDraft(): Promise<void> {
    await this.clickAndAwait(
      this.cancelButton,
      (r) =>
        r.request().method() === "DELETE" && journalsUrls.entry.test(r.url()),
    );
  }

  async togglePreview(): Promise<void> {
    await this.clickAndAwait(
      this.previewToggle,
      isPostTo(journalsUrls.preview),
    );
  }

  /** Leaves the preview for the editor, which the preview hides. */
  async showEditor(): Promise<void> {
    await this.writeTab.click();
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

  private async clickAndAwait(
    button: Locator,
    responds: (response: Response) => boolean,
  ): Promise<void> {
    const responded = this.page.waitForResponse(responds);
    await button.click();
    await responded;
  }
}
