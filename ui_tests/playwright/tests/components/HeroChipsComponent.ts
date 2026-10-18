import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The hero's genre and tag chip rows, and the pills that edit them in place. */
export class HeroChipsComponent extends BaseComponent {
  readonly addGenresPill: Locator;
  readonly addTagsPill: Locator;
  readonly genreRow: Locator;
  readonly tagRow: Locator;
  readonly genreRowGenresPill: Locator;
  readonly genreRowTagsPill: Locator;
  readonly tagRowTagsPill: Locator;
  readonly tagRowGenresPill: Locator;
  readonly genreList: Locator;
  readonly tagList: Locator;
  readonly genresInput: Locator;
  readonly tagsInput: Locator;
  readonly tagsEditor: Locator;
  readonly tagSuggestions: Locator;

  constructor(page: Page) {
    super(page);
    this.addGenresPill = page.getByTestId("bd-add-genres");
    this.addTagsPill = page.getByTestId("bd-add-tags");
    this.genreRow = page.getByTestId("bd-genre-row");
    this.tagRow = page.getByTestId("bd-tag-row");
    this.genreRowGenresPill = this.genreRow.getByTestId("bd-add-genres");
    this.genreRowTagsPill = this.genreRow.getByTestId("bd-add-tags");
    this.tagRowTagsPill = this.tagRow.getByTestId("bd-add-tags");
    this.tagRowGenresPill = this.tagRow.getByTestId("bd-add-genres");
    this.genreList = page.getByTestId("bd-genre-list");
    this.tagList = page.getByTestId("bd-tag-list");
    this.genresInput = page.getByTestId("bd-genres-input");
    this.tagsInput = page.getByTestId("bd-tags-input");
    this.tagsEditor = page.getByTestId("bd-tags-editor");
    this.tagSuggestions = page.getByTestId("bd-tags-suggestions");
  }

  async openTagEditor(): Promise<void> {
    await this.addTagsPill.click();
  }

  async openGenreEditor(): Promise<void> {
    await this.addGenresPill.click();
  }

  /** Types a tag into the open editor and presses Enter, which saves it. */
  async addTag(tag: string): Promise<void> {
    await this.tagsInput.fill(tag);
    await this.tagsInput.press("Enter");
  }

  /** Types a genre into the open editor and presses Enter, which saves it. */
  async addGenre(genre: string): Promise<void> {
    await this.genresInput.fill(genre);
    await this.genresInput.press("Enter");
  }

  async closeTagEditor(): Promise<void> {
    await this.tagsInput.press("Escape");
  }

  async closeGenreEditor(): Promise<void> {
    await this.genresInput.press("Escape");
  }
}
