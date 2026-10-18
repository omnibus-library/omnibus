import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The metadata edit form, shared by the edit page and the add-books review. */
export class MetadataFormComponent extends BaseComponent {
  readonly titleField: Locator;
  readonly publisherField: Locator;
  readonly publishedField: Locator;
  readonly seriesField: Locator;
  readonly bookNumberField: Locator;
  readonly authorChips: Locator;
  readonly coverPreviewImage: Locator;
  readonly coverHintText: Locator;
  readonly coverUploadInput: Locator;
  readonly coverReplacedNote: Locator;
  readonly removeCoverOverrideButton: Locator;
  readonly saveButton: Locator;
  readonly discardButton: Locator;

  constructor(page: Page) {
    super(page);
    this.titleField = page.getByLabel("Title");
    this.publisherField = page.getByLabel("Publisher");
    this.publishedField = page.getByLabel("Published");
    this.seriesField = page.getByLabel("Series", { exact: true });
    this.bookNumberField = page.getByLabel("Book #");
    this.authorChips = page.locator(".me-chip-item");
    this.coverPreviewImage = page
      .getByTestId("cover-staged-preview")
      .locator("img");
    this.coverHintText = page.getByTestId("cover-hint");
    this.coverUploadInput = page.getByTestId("cover-upload-input");
    this.coverReplacedNote = page.getByTestId("me-cover-replaced");
    this.removeCoverOverrideButton = page.getByTestId("cover-remove-override");
    this.saveButton = page.getByTestId("me-save");
    this.discardButton = page.getByTestId("me-discard");
  }

  /** The chip for one author the form will save. */
  authorChip(name: string): Locator {
    return this.authorChips.getByText(name);
  }
}
