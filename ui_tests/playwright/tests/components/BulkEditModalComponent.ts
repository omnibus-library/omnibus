import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The modal that writes one set of overrides to every selected book. */
export class BulkEditModalComponent extends BaseComponent {
  readonly root: Locator;
  readonly publisherField: Locator;
  readonly tagsField: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("bulk-edit-modal");
    this.publisherField = this.root.getByLabel("Publisher");
    this.tagsField = this.root.getByTestId("bulk-add-tags-input");
    this.submitButton = page.getByTestId("bulk-edit-submit");
    this.errorMessage = page.getByTestId("bulk-edit-error");
  }

  async setPublisher(publisher: string): Promise<void> {
    await this.publisherField.fill(publisher);
  }

  /** Types a tag and presses Enter to add it to the edit. */
  async addTag(tag: string): Promise<void> {
    await this.tagsField.fill(tag);
    await this.tagsField.press("Enter");
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }
}
