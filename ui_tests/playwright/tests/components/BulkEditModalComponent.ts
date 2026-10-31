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
    this.root = page.getByRole("dialog", { name: /^Bulk edit / });
    this.publisherField = this.root.getByLabel("Publisher");
    this.tagsField = this.root.getByLabel("Add tags", { exact: true });
    this.submitButton = this.root.getByRole("button", { name: /^Apply to / });
    this.errorMessage = this.root.getByRole("alert");
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
