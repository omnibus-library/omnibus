import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/**
 * The metadata edit form with its cover controls and save bar, shared by the
 * edit page and the add-books review. Fields are found by label within their
 * own wrappers: the edition picker mounts inside the form and repeats them.
 */
export class MetadataFormComponent extends BaseComponent {
  readonly titleField: Locator;
  readonly publisherField: Locator;
  readonly publishedField: Locator;
  readonly seriesField: Locator;
  readonly bookNumberField: Locator;
  readonly isbn13Field: Locator;
  readonly isbn10Field: Locator;
  readonly printPagesField: Locator;
  readonly descriptionField: Locator;

  readonly authorChips: Locator;
  readonly authorsInput: Locator;
  readonly authorSuggestions: Locator;
  readonly authorSuggestionOptions: Locator;
  private readonly tagInput: Locator;
  readonly seriesSuggestions: Locator;

  readonly coverPreviewImage: Locator;
  readonly currentCoverImage: Locator;
  readonly coverHintText: Locator;
  readonly coverUploadInput: Locator;
  readonly coverUploadStatus: Locator;
  readonly coverReplacedNote: Locator;
  readonly removeCoverOverrideButton: Locator;
  readonly coverUrlField: Locator;
  readonly applyCoverUrlButton: Locator;

  readonly saveButton: Locator;
  readonly discardButton: Locator;

  constructor(page: Page) {
    super(page);
    const fields = page.locator(".me-form .me-field");
    this.titleField = fields.getByLabel("Title");
    this.publisherField = fields.getByLabel("Publisher");
    this.publishedField = fields.getByLabel("Published");
    // Not exact: an edited field's label gains an "EDITED" badge.
    this.seriesField = fields.getByLabel("Series");
    this.bookNumberField = fields.getByLabel("Book #");
    this.isbn13Field = fields.getByLabel("ISBN-13");
    this.isbn10Field = fields.getByLabel("ISBN-10");
    this.printPagesField = fields.getByLabel("Print Pages");
    this.descriptionField = fields.getByLabel("Description");

    this.authorChips = page.locator(".me-chip-item");
    this.authorsInput = page.getByTestId("me-authors-input");
    this.authorSuggestions = page.getByTestId("me-authors-suggestions");
    this.authorSuggestionOptions = this.authorSuggestions.getByRole("option");
    this.tagInput = page.getByPlaceholder("+ add tag…");
    this.seriesSuggestions = page.getByTestId("me-series-suggestions");

    this.coverPreviewImage = page
      .getByTestId("cover-staged-preview")
      .locator("img");
    this.currentCoverImage = page.locator(".me-cover-preview img");
    this.coverHintText = page.getByTestId("cover-hint");
    this.coverUploadInput = page.getByTestId("cover-upload-input");
    this.coverUploadStatus = page.getByTestId("cover-upload-status");
    this.coverReplacedNote = page.getByTestId("me-cover-replaced");
    this.removeCoverOverrideButton = page.getByTestId("cover-remove-override");
    this.coverUrlField = page.getByLabel("Or paste an image URL");
    this.applyCoverUrlButton = page.getByRole("button", {
      name: "Apply",
      exact: true,
    });

    this.saveButton = page.getByTestId("me-save");
    this.discardButton = page.getByTestId("me-discard");
  }

  /** The chip for one author the form will save. */
  authorChip(name: string): Locator {
    return this.authorChips.getByText(name);
  }

  /** A tag's chip, found by its text. */
  tagChip(tag: string): Locator {
    return this.page.getByText(tag);
  }

  /** The author suggestion whose name matches. */
  authorSuggestion(name: RegExp): Locator {
    return this.authorSuggestions.getByRole("option", { name });
  }

  /** The series suggestion whose name matches. */
  seriesSuggestion(name: RegExp): Locator {
    return this.seriesSuggestions.getByRole("option", { name });
  }

  async authorSuggestionCount(): Promise<number> {
    return this.authorSuggestionOptions.count();
  }

  /** The save bar's count of edited fields, such as "2 fields edited". */
  editedSummary(count: number): Locator {
    return this.page.getByText(
      `${count} ${count === 1 ? "field" : "fields"} edited`,
    );
  }

  async enterTitle(title: string): Promise<void> {
    await this.titleField.fill(title);
  }

  async enterIsbn13(isbn: string): Promise<void> {
    await this.isbn13Field.fill(isbn);
  }

  async enterIsbn10(isbn: string): Promise<void> {
    await this.isbn10Field.fill(isbn);
  }

  async enterPrintPages(pages: string): Promise<void> {
    await this.printPagesField.fill(pages);
  }

  /** Adds a tag chip with Enter, which clears the input as the chip lands. */
  async addTag(tag: string): Promise<void> {
    await this.tagInput.fill(tag);
    await this.tagInput.press("Enter");
  }

  async typeAuthor(text: string): Promise<void> {
    await this.authorsInput.fill(text);
  }

  /** Commits what is typed as a new author chip, suggestion or not. */
  async commitAuthor(): Promise<void> {
    await this.authorsInput.press("Enter");
  }

  /** Commits the first author suggestion, reached with ↓ then Enter. */
  async pickFirstAuthorSuggestion(): Promise<void> {
    await this.authorsInput.press("ArrowDown");
    await this.authorsInput.press("Enter");
  }

  async typeSeries(text: string): Promise<void> {
    await this.seriesField.fill(text);
  }

  /** Fills the series from its first suggestion, reached with ↓ then Enter. */
  async pickFirstSeriesSuggestion(): Promise<void> {
    await this.seriesField.press("ArrowDown");
    await this.seriesField.press("Enter");
  }

  async enterCoverUrl(url: string): Promise<void> {
    await this.coverUrlField.fill(url);
  }

  /** Clicks Apply; a test that asserts the write wraps it. */
  async applyCoverUrl(): Promise<void> {
    await this.applyCoverUrlButton.click();
  }

  /** Applies the typed cover URL with Enter rather than the button. */
  async submitCoverUrl(): Promise<void> {
    await this.coverUrlField.press("Enter");
  }

  async removeCoverOverride(): Promise<void> {
    await this.removeCoverOverrideButton.click();
  }

  /** Clicks Save; a test that asserts the write wraps it. */
  async save(): Promise<void> {
    await this.saveButton.click();
  }

  async discard(): Promise<void> {
    await this.discardButton.click();
  }
}
