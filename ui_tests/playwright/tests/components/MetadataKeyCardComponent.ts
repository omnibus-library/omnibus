import type { Locator, Page } from "@playwright/test";
import type { MetadataProvider } from "../data/metadataKeys";
import { BaseComponent } from "./BaseComponent";

/** One provider's API key card in Administration › Integrations. */
export class MetadataKeyCardComponent extends BaseComponent {
  readonly root: Locator;
  readonly keyField: Locator;
  readonly saveButton: Locator;
  readonly clearButton: Locator;
  readonly confirmClearButton: Locator;
  readonly connectionStatus: Locator;
  readonly message: Locator;

  constructor(page: Page, provider: MetadataProvider, keyLabel: string) {
    super(page);
    // Each card has Save and Clear buttons, so they are found by test id.
    this.root = page.getByTestId(`${provider}-key-card`);
    this.keyField = page.getByLabel(keyLabel);
    this.saveButton = page.getByTestId(`${provider}-save`);
    this.clearButton = page.getByTestId(`${provider}-clear`);
    this.confirmClearButton = page.getByTestId(
      `${provider}-clear-dialog-confirm`,
    );
    this.connectionStatus = page.getByTestId(`${provider}-status`);
    this.message = page.getByTestId(`${provider}-key-status`);
  }

  async fillKey(key: string): Promise<void> {
    await this.keyField.fill(key);
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }

  /** Clears the key, answering the confirmation that asks first. */
  async clear(): Promise<void> {
    await this.clearButton.click();
    await this.confirmClearButton.click();
  }
}
