import type { Locator, Page } from "@playwright/test";
import { journalsUrls } from "../contracts/journals";
import { BaseComponent } from "./BaseComponent";

/** One entry's card in the journal feed: its body, and for its author Publish, Edit and Delete. */
export class JournalEntryCardComponent extends BaseComponent {
  readonly youChip: Locator;
  readonly errorAlert: Locator;

  private readonly editButton: Locator;
  private readonly editField: Locator;
  private readonly saveEditButton: Locator;

  private readonly deleteButton: Locator;
  readonly deleteDialog: Locator;
  private readonly confirmDeleteButton: Locator;

  readonly draftChip: Locator;
  readonly publishDraftButton: Locator;

  /** "Read more" under a clamped body; it reads "Show less" once expanded. */
  readonly readMoreButton: Locator;
  readonly clampedBody: Locator;
  readonly body: Locator;

  readonly orderedListItems: Locator;
  readonly nestedListItem: Locator;
  readonly blockquote: Locator;
  readonly blockquoteBreaks: Locator;
  readonly figureImage: Locator;
  readonly figureCaption: Locator;

  readonly spoiler: Locator;
  readonly revealSpoilerButton: Locator;
  readonly spoilerText: Locator;

  constructor(
    page: Page,
    readonly root: Locator,
  ) {
    super(page);
    this.youChip = root.getByText("you", { exact: true });
    this.errorAlert = root.getByRole("alert");

    this.editButton = root.getByTestId("journal-edit");
    this.editField = page.getByTestId("journal-edit-editor");
    this.saveEditButton = page.getByTestId("journal-edit-save");

    this.deleteButton = root.getByTestId("journal-delete");
    this.deleteDialog = page.getByTestId("journal-delete-modal");
    this.confirmDeleteButton = page.getByTestId("journal-delete-modal-confirm");

    this.draftChip = root.getByTestId("journal-draft-chip");
    this.publishDraftButton = root.getByTestId("journal-publish-draft");

    this.readMoreButton = root.getByRole("button", {
      name: /^(Read more|Show less)$/,
    });
    this.clampedBody = root.locator(".bp-entry-text.is-clamped");
    this.body = root.locator(".bp-entry-text");

    this.orderedListItems = root.locator("ol > li");
    this.nestedListItem = root.locator("li > ul > li");
    this.blockquote = root.locator("blockquote");
    this.blockquoteBreaks = root.locator("blockquote br");
    this.figureImage = root.locator(".journal-figure img");
    this.figureCaption = root.locator(".journal-figure figcaption");

    this.spoiler = root.locator(".spoiler");
    this.revealSpoilerButton = root.getByRole("button", {
      name: "Reveal spoiler",
    });
    this.spoilerText = this.revealSpoilerButton.locator(".spoiler-text");
  }

  /** The spoiler once revealed, which its own text names. */
  revealedSpoiler(text: string): Locator {
    return this.root.getByRole("button", { name: text });
  }

  async startEdit(): Promise<void> {
    await this.editButton.click();
  }

  async rewrite(text: string): Promise<void> {
    await this.editField.fill(text);
  }

  async saveEdit(): Promise<void> {
    await this.clickAndAwait(this.saveEditButton, "PATCH");
  }

  /** Opens the "This can't be undone" confirm; nothing is deleted yet. */
  async startDelete(): Promise<void> {
    await this.deleteButton.click();
  }

  async confirmDelete(): Promise<void> {
    await this.clickAndAwait(this.confirmDeleteButton, "DELETE");
  }

  async publishDraft(): Promise<void> {
    await this.clickAndAwait(this.publishDraftButton, "PATCH");
  }

  async readMore(): Promise<void> {
    await this.readMoreButton.click();
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

  /** Whether the body is laid out whole, not cut at its clamp. */
  showsWholeBody(): Promise<boolean> {
    return this.body.evaluate((el) => el.scrollHeight - el.clientHeight <= 1);
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
      // whatever width the card happens to have.
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

  private async clickAndAwait(
    button: Locator,
    method: "PATCH" | "DELETE",
  ): Promise<void> {
    const responded = this.page.waitForResponse(
      (r) =>
        r.request().method() === method && journalsUrls.entry.test(r.url()),
    );
    await button.click();
    await responded;
  }
}
