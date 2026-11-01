import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** One option a field's datalist offers: the name, and its book count. */
export type Suggestion = { value: string; label: string };

/**
 * The editor sheet's tabs, fields, cover card and save bar, shared by the edit
 * sheet and the add-book review. Fields are found by label inside the Details
 * panel, the cover controls inside Artwork; a hidden tab's controls are not.
 */
export class MetadataFormComponent extends BaseComponent {
  readonly detailsTab: Locator;
  readonly artworkTab: Locator;

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
  private readonly tagInput: Locator;

  readonly coverPreviewImage: Locator;
  readonly coverHintText: Locator;
  readonly coverUploadInput: Locator;
  readonly coverUploadStatus: Locator;
  readonly removeCoverOverrideButton: Locator;
  readonly dropHeldCoverButton: Locator;
  readonly coverUrlField: Locator;
  readonly applyCoverUrlButton: Locator;

  readonly saveButton: Locator;
  readonly discardButton: Locator;
  readonly saveState: Locator;
  readonly saveError: Locator;

  constructor(page: Page) {
    super(page);
    // Exact: the book page under the sheet has a "Files & Details" tab.
    this.detailsTab = page.getByRole("tab", { name: "Details", exact: true });
    this.artworkTab = page.getByRole("tab", { name: "Artwork", exact: true });

    const fields = page.getByRole("tabpanel", { name: "Details", exact: true });
    // Anchored: an edited field's label gains an "Edited" marker, and Series
    // would otherwise also match "Number in series".
    this.titleField = fields.getByLabel(/^Title/);
    this.publisherField = fields.getByLabel(/^Publisher/);
    this.publishedField = fields.getByLabel(/^Published/);
    this.seriesField = fields.getByLabel(/^Series/);
    this.bookNumberField = fields.getByLabel(/^Number in series/);
    this.isbn13Field = fields.getByLabel(/^ISBN-13/);
    this.isbn10Field = fields.getByLabel(/^ISBN-10/);
    this.printPagesField = fields.getByLabel(/^Print pages/);
    this.descriptionField = fields.getByLabel(/^Description/);

    this.authorsInput = fields.getByTestId("me-authors-input");
    this.authorChips = fields
      .locator(".me-field", { has: page.getByTestId("me-authors-input") })
      .locator(".me-chip-item");
    this.tagInput = fields.getByPlaceholder("+ add tag…");

    const artwork = page.getByRole("tabpanel", { name: "Artwork" });
    this.coverPreviewImage = artwork
      .getByTestId("cover-staged-preview")
      .locator("img");
    this.coverHintText = artwork.getByTestId("cover-hint");
    this.coverUploadInput = artwork.getByTestId("cover-upload-input");
    this.coverUploadStatus = artwork.getByTestId("cover-upload-status");
    this.removeCoverOverrideButton = artwork.getByTestId(
      "cover-remove-override",
    );
    this.dropHeldCoverButton = artwork.getByTestId("cover-drop-held");
    this.coverUrlField = artwork.getByLabel("Or paste an image URL");
    this.applyCoverUrlButton = artwork.getByRole("button", {
      name: "Apply",
      exact: true,
    });

    this.saveButton = page.getByTestId("es-done");
    this.discardButton = page.getByTestId("es-discard");
    this.saveState = page.getByTestId("es-save-state");
    this.saveError = page.locator(".es-foot").getByRole("alert");
  }

  /** The chip for one author the form will save. */
  authorChip(name: string): Locator {
    return this.authorChips.getByText(name, { exact: true });
  }

  /** A tag's chip, found by its text. */
  tagChip(tag: string): Locator {
    return this.page.getByText(tag, { exact: true });
  }

  /** The save bar's count of unsaved changes, such as "2 unsaved changes". */
  editedSummary(count: number): Locator {
    return this.saveState.filter({
      hasText: `${count} unsaved ${count === 1 ? "change" : "changes"}`,
    });
  }

  /** What the Authors field's datalist offers for what is typed now. */
  async authorSuggestions(): Promise<Suggestion[]> {
    return this.datalistOf(this.authorsInput);
  }

  /** What the Series field's datalist offers. */
  async seriesSuggestions(): Promise<Suggestion[]> {
    return this.datalistOf(this.seriesField);
  }

  async openDetails(): Promise<void> {
    await this.detailsTab.click();
  }

  async openArtwork(): Promise<void> {
    await this.artworkTab.click();
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

  /** Commits what is typed as a new author chip. */
  async commitAuthor(): Promise<void> {
    await this.authorsInput.press("Enter");
  }

  async typeSeries(text: string): Promise<void> {
    await this.seriesField.fill(text);
  }

  async enterCoverUrl(url: string): Promise<void> {
    await this.coverUrlField.fill(url);
  }

  /** Clicks Apply, which holds the URL's image for Done to fetch. */
  async applyCoverUrl(): Promise<void> {
    await this.applyCoverUrlButton.click();
  }

  /** Applies the typed cover URL with Enter rather than the button. */
  async submitCoverUrl(): Promise<void> {
    await this.coverUrlField.press("Enter");
  }

  /** Puts the scanned cover back (a write), or the file's own one in a review. */
  async removeCoverOverride(): Promise<void> {
    await this.removeCoverOverrideButton.click();
  }

  /** Clicks Done, which saves any changes and closes the sheet. */
  async save(): Promise<void> {
    await this.saveButton.click();
  }

  async discard(): Promise<void> {
    await this.discardButton.click();
  }

  /** The options of the datalist `input` reads, as the browser would offer them. */
  private async datalistOf(input: Locator): Promise<Suggestion[]> {
    return input.evaluate((el) =>
      Array.from((el as HTMLInputElement).list?.options ?? [], (option) => ({
        value: option.value,
        label: option.label,
      })),
    );
  }
}
