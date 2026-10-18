import type { Locator, Page } from "@playwright/test";
import { physicalUrls } from "../contracts/physical";
import type { CopyRow } from "../data/physical";
import { isPostTo } from "../utils/api";
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
    this.confirmDeleteButton = page.getByTestId("copy-delete-confirm");
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
    const saved = this.page.waitForResponse(isPostTo(physicalUrls.copyNote));
    await this.saveNoteButton.click();
    await saved;
  }

  /** Opens the delete dialog, with extra choices for a book's last copy. */
  async openDeleteDialog(): Promise<void> {
    await this.deleteButton.click();
  }

  async confirmDelete(): Promise<void> {
    const deleted = this.page.waitForResponse(
      isPostTo(physicalUrls.deleteCopy),
    );
    await this.confirmDeleteButton.click();
    await deleted;
  }

  /** Deletes the last copy and its book, then waits for the book delete. */
  async removeFromLibrary(): Promise<void> {
    const removed = this.page.waitForResponse(
      isPostTo(physicalUrls.deleteBook),
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

  /** Accepts a note save, answering with the copy as it now reads. */
  async stubNoteSave(saved: CopyRow): Promise<void> {
    await this.page.route(physicalUrls.copyNote, (route) =>
      route.fulfill({ json: saved }),
    );
  }

  /** Accepts a copy delete without writing it. */
  async stubDelete(): Promise<void> {
    await this.page.route(physicalUrls.deleteCopy, (route) =>
      route.fulfill({ json: null }),
    );
  }
}
