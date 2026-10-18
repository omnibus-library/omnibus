import type { Locator, Page } from "@playwright/test";
import { physicalUrls } from "../contracts/physical";
import type { CopyRow } from "../data/physical";
import { isPostTo } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** The physical copies panel under the hero: a copy's note and delete controls. */
export class PhysicalCopyCardComponent extends BaseComponent {
  readonly panel: Locator;
  readonly loadError: Locator;
  readonly editNoteButton: Locator;
  private readonly noteField: Locator;
  private readonly saveNoteButton: Locator;
  readonly deleteDialog: Locator;
  private readonly confirmDeleteButton: Locator;

  constructor(page: Page) {
    super(page);
    this.panel = page.getByTestId("bd-physical-panel");
    this.loadError = page.getByTestId("physical-error");
    this.editNoteButton = page.getByTestId("copy-edit-note");
    this.noteField = page.getByLabel("Edition note");
    this.saveNoteButton = page.getByTestId("copy-note-save");
    this.deleteDialog = page.getByTestId("copy-delete-modal");
    this.confirmDeleteButton = page.getByTestId("copy-delete-confirm");
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

  async confirmDelete(): Promise<void> {
    const deleted = this.page.waitForResponse(
      isPostTo(physicalUrls.deleteCopy),
    );
    await this.confirmDeleteButton.click();
    await deleted;
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
