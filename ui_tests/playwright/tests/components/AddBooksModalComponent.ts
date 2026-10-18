import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The library picker modal that files existing books on a shelf. */
export class AddBooksModalComponent extends BaseComponent {
  readonly root: Locator;
  readonly searchField: Locator;
  readonly submitButton: Locator;
  readonly closeButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("add-books-modal");
    this.searchField = this.root.getByTestId("add-books-search");
    this.submitButton = this.root.getByTestId("add-books-submit");
    this.closeButton = this.root.getByTestId("add-books-close");
    this.errorMessage = this.root.getByTestId("add-books-error");
  }

  /** A book's card in the picker, found by its uuid, not its position. */
  tile(bookUuid: string): Locator {
    return this.root.getByTestId(`picker-tile-${bookUuid}`);
  }

  /** The dialog's heading, which names the shelf being added to. */
  heading(shelfName: string): Locator {
    return this.root.getByRole("heading", { level: 2, name: shelfName });
  }

  /** A card's rendered width; a button shrink-wraps, so a hit can be a sliver. */
  async tileWidth(bookUuid: string): Promise<number> {
    return (await this.tile(bookUuid).boundingBox())?.width ?? 0;
  }

  async search(query: string): Promise<void> {
    await this.searchField.fill(query);
  }

  async pick(bookUuid: string): Promise<void> {
    await this.tile(bookUuid).click();
  }

  /** Presses a card that is disabled, to show it is inert and not just styled. */
  async pickAnyway(bookUuid: string): Promise<void> {
    await this.tile(bookUuid).click({ force: true });
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }
}
