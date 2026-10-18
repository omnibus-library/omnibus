import type { Locator, Page } from "@playwright/test";
import { settingsUrls } from "../contracts/settings";
import { recordRequests } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** A library whose lookup order the metadata section sets. */
export type PrecedenceLibrary = "ebook" | "audiobook";

/** Administration › Metadata: the order the providers are asked in. */
export class MetadataSectionComponent extends BaseComponent {
  readonly saveButton: Locator;
  readonly status: Locator;

  constructor(page: Page) {
    super(page);
    this.saveButton = page.getByTestId("metadata-precedence-save");
    this.status = page.getByTestId("metadata-precedence-status");
  }

  /** The provider at `index` in `library`'s order. */
  item(library: PrecedenceLibrary, index: number): Locator {
    return this.page.getByTestId(
      `${library}-metadata-precedence-item-${index}`,
    );
  }

  async moveDown(library: PrecedenceLibrary, index: number): Promise<void> {
    await this.page
      .getByTestId(`${library}-metadata-precedence-down-${index}`)
      .click();
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }

  /** The methods of every save sent from now on. */
  recordSaves(): string[] {
    return recordRequests(this.page, settingsUrls.metadataPrecedence);
  }

  /** Answers a save with the order it sent; the order is instance configuration. */
  async stubSaved(): Promise<void> {
    await this.page.route(settingsUrls.metadataPrecedence, (route) =>
      route.fulfill({ json: route.request().postDataJSON().precedence }),
    );
  }
}
