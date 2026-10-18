import type { Locator, Page } from "@playwright/test";
import { journalsUrls } from "../contracts/journals";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** A box in CSS pixels, as `boundingBox` reports it. */
type Box = { x: number; y: number; width: number; height: number };

/** The overlay that opens one journal entry whole, over the journal stop. */
export class JournalEntryOverlayComponent extends BaseComponent {
  readonly root: Locator;
  readonly closeButton: Locator;
  private readonly card: Locator;
  readonly youChip: Locator;
  readonly errorAlert: Locator;

  private readonly editButton: Locator;
  private readonly editField: Locator;
  private readonly saveEditButton: Locator;

  private readonly deleteButton: Locator;
  private readonly confirmDeleteButton: Locator;

  readonly draftChip: Locator;
  readonly publishDraftButton: Locator;

  readonly showMoreButton: Locator;
  readonly collapsedBody: Locator;

  readonly orderedListItems: Locator;
  readonly nestedListItem: Locator;
  readonly blockquote: Locator;
  readonly blockquoteBreaks: Locator;
  readonly figureImage: Locator;
  readonly figureCaption: Locator;

  readonly spoiler: Locator;
  readonly revealSpoilerButton: Locator;
  readonly spoilerText: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("journal-overlay");
    this.closeButton = page.getByTestId("journal-overlay-close");
    this.card = this.root.getByTestId("journal-entry");
    this.youChip = this.card.getByText("you");
    this.errorAlert = this.card.getByRole("alert");

    this.editButton = this.card.getByTestId("journal-edit");
    this.editField = page.getByTestId("journal-edit-editor");
    this.saveEditButton = page.getByTestId("journal-edit-save");

    this.deleteButton = this.card.getByTestId("journal-delete");
    this.confirmDeleteButton = page.getByTestId("journal-delete-confirm");

    this.draftChip = this.card.getByTestId("journal-draft-chip");
    this.publishDraftButton = this.card.getByTestId("journal-publish-draft");

    this.showMoreButton = page.getByTestId("journal-show-more");
    this.collapsedBody = this.card.locator(".bd-journal-entry-body-collapsed");

    this.orderedListItems = this.card.locator("ol > li");
    this.nestedListItem = this.card.locator("li > ul > li");
    this.blockquote = this.card.locator("blockquote");
    this.blockquoteBreaks = this.card.locator("blockquote br");
    this.figureImage = this.card.locator(".journal-figure img");
    this.figureCaption = this.card.locator(".journal-figure figcaption");

    this.spoiler = this.card.locator(".spoiler");
    this.revealSpoilerButton = this.card.getByRole("button", {
      name: "Reveal spoiler",
    });
    this.spoilerText = this.revealSpoilerButton.locator(".spoiler-text");
  }

  /** The open entry whose rendered body contains `text`. */
  entryWithText(text: string): Locator {
    return this.page.getByTestId("journal-entry").filter({ hasText: text });
  }

  /** The spoiler once revealed, which its own text names. */
  revealedSpoiler(text: string): Locator {
    return this.card.getByRole("button", { name: text });
  }

  async startEdit(): Promise<void> {
    await this.editButton.click();
  }

  async rewrite(text: string): Promise<void> {
    await this.editField.fill(text);
  }

  async saveEdit(): Promise<void> {
    await this.clickAndAwait(this.saveEditButton, journalsUrls.update);
  }

  /** Opens the "This can't be undone" confirm; nothing is deleted yet. */
  async startDelete(): Promise<void> {
    await this.deleteButton.click();
  }

  async confirmDelete(): Promise<void> {
    await this.clickAndAwait(this.confirmDeleteButton, journalsUrls.delete);
  }

  async publishDraft(): Promise<void> {
    await this.clickAndAwait(this.publishDraftButton, journalsUrls.update);
  }

  async revealSpoilerWithClick(): Promise<void> {
    await this.spoiler.click();
  }

  async focusSpoiler(): Promise<void> {
    await this.revealSpoilerButton.focus();
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  /** Starts noting whether the page cancels the default of each Space press. */
  async watchSpaceKey(): Promise<void> {
    // A window listener runs after the document one, so it sees whether the
    // control prevented the default.
    await this.page.evaluate(() => {
      window.addEventListener("keydown", (e) => {
        if (e.key === " ")
          Reflect.set(window, "spacePrevented", e.defaultPrevented);
      });
    });
  }

  /** Whether the last Space press was cancelled; undefined before one. */
  spaceKeyWasPrevented(): Promise<boolean | undefined> {
    return this.page.evaluate(() => Reflect.get(window, "spacePrevented"));
  }

  overlayBox(): Promise<Box | null> {
    return this.root.boundingBox();
  }

  cardBox(): Promise<Box | null> {
    return this.page.locator(".bdmq-ocard").boundingBox();
  }

  /** How many pixels the card's content overruns its own height. */
  cardOverflow(): Promise<number> {
    return this.page
      .locator(".bdmq-ocard")
      .evaluate((el) => el.scrollHeight - el.clientHeight);
  }

  viewportSize(): { width: number; height: number } | null {
    return this.page.viewportSize();
  }

  /** How the card's one spoiler sits in its list item, and how it wraps. */
  spoilerInListLayout(): Promise<{
    inList: boolean;
    fragments: number;
    lineHeight: number;
    firstTopDelta: number;
  }> {
    return this.spoiler.evaluate((el) => {
      const li = el.closest("li");
      const rects = el.getClientRects();
      return {
        inList: li !== null,
        fragments: rects.length,
        lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
        firstTopDelta: li ? rects[0]!.top - li.getBoundingClientRect().top : -1,
      };
    });
  }

  /** Narrows the spoiler's paragraph to 360px, then reads how it wraps. */
  measureSpoilerInNarrowParagraph(): Promise<{
    bracket: string;
    fragments: number;
    sameLine: boolean;
  }> {
    return this.spoiler.evaluate((el) => {
      // Narrow the paragraph so the spoiler cannot fit on any one line,
      // whatever width the overlay card happens to have.
      const p = el.closest("p")!;
      p.style.width = "360px";
      const rects = Array.from(el.getClientRects());
      const before = el.previousSibling!;
      const range = document.createRange();
      const text = before.textContent ?? "";
      range.setStart(before, text.length - 1);
      range.setEnd(before, text.length);
      const paren = range.getBoundingClientRect();
      const mid = (r: DOMRect) => (r.top + r.bottom) / 2;
      return {
        bracket: range.toString(),
        fragments: rects.length,
        sameLine: Math.abs(mid(paren) - mid(rects[0]!)) < rects[0]!.height / 2,
      };
    });
  }

  private async clickAndAwait(button: Locator, url: RegExp): Promise<void> {
    const responded = this.page.waitForResponse(isPostTo(url));
    await button.click();
    await responded;
  }
}
