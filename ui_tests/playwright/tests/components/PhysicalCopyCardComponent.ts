import type { Locator, Page } from "@playwright/test";
import { physicalUrls } from "../contracts/physical";
import type { CopyRow } from "../data/physical";
import { isResponseTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** The physical copies panel under the hero: a copy's note and delete controls. */
export class PhysicalCopyCardComponent extends BaseComponent {
  readonly panel: Locator;
  readonly cards: Locator;
  readonly loadError: Locator;
  readonly editNoteButton: Locator;
  private readonly noteField: Locator;
  private readonly saveNoteButton: Locator;
  readonly deleteButton: Locator;
  readonly deleteDialog: Locator;
  private readonly confirmDeleteButton: Locator;
  readonly lastCopyDialog: Locator;
  private readonly removeFromLibraryButton: Locator;

  constructor(page: Page) {
    super(page);
    this.panel = page.getByTestId("bd-physical-panel");
    this.cards = page.getByTestId("physical-copy-card");
    this.loadError = page.getByTestId("physical-error");
    this.editNoteButton = page.getByTestId("copy-edit-note");
    this.noteField = page.getByLabel("Edition note");
    this.saveNoteButton = page.getByTestId("copy-note-save");
    this.deleteButton = page.getByTestId("copy-delete");
    this.deleteDialog = page.getByTestId("copy-delete-modal");
    this.confirmDeleteButton = page.getByTestId("copy-delete-modal-confirm");
    this.lastCopyDialog = page.getByTestId("last-copy-modal");
    this.removeFromLibraryButton = this.lastCopyDialog.getByRole("button", {
      name: "Remove from library",
    });
  }

  /** The copy card a test filed, picked out by its unique note. */
  card(note: string): Locator {
    return this.cards.filter({ hasText: note });
  }

  async editNote(note: string): Promise<void> {
    await this.editNoteButton.click();
    await this.noteField.fill(note);
  }

  async saveNote(): Promise<void> {
    const saved = this.page.waitForResponse(
      isResponseTo({ method: "PATCH", url: physicalUrls.copy }),
    );
    await this.saveNoteButton.click();
    await saved;
  }

  /** Opens the delete dialog, with extra choices for a book's last copy. */
  async openDeleteDialog(): Promise<void> {
    await this.deleteButton.click();
  }

  async confirmDelete(): Promise<void> {
    const deleted = this.page.waitForResponse(
      isResponseTo({ method: "DELETE", url: physicalUrls.copy }),
    );
    await this.confirmDeleteButton.click();
    await deleted;
  }

  /** Deletes the last copy and its book, then waits for the book delete. */
  async removeFromLibrary(): Promise<void> {
    const removed = this.page.waitForResponse(
      isResponseTo({ method: "DELETE", url: physicalUrls.book }),
    );
    await this.removeFromLibraryButton.click();
    await removed;
  }

  /** Answers the on-mount copies read with `copies`. */
  async stubLoad(copies: CopyRow[]): Promise<void> {
    await this.page.route(physicalUrls.copies, (route) =>
      route.fulfill({ json: copies }),
    );
  }

  /** Accepts a note save, answering with the copy as it now reads, as the refetch does. */
  async stubNoteSave(saved: CopyRow): Promise<void> {
    await this.stubWrite("PATCH", { json: saved }, [saved]);
  }

  /** Accepts a copy delete without writing it; the refetch finds no copies. */
  async stubDelete(): Promise<void> {
    await this.stubWrite("DELETE", { status: 204 }, []);
  }

  /** Answers a `method` write to a copy with `answer`, then the copies refetch with `after`. */
  private async stubWrite(
    method: "PATCH" | "DELETE",
    answer: { json?: unknown; status?: number },
    after: CopyRow[],
  ): Promise<void> {
    let written = false;
    await this.page.route(physicalUrls.copy, (route) => {
      if (route.request().method() !== method) return route.fallback();
      written = true;
      return route.fulfill(answer);
    });
    await this.page.route(physicalUrls.copies, (route) =>
      written ? route.fulfill({ json: after }) : route.fallback(),
    );
  }
}
