import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** Settings → Kindle: the Send-to-Kindle destination address. */
export class KindleSectionComponent extends BaseComponent {
  readonly card: Locator;
  readonly heading: Locator;
  readonly emailField: Locator;
  readonly saveButton: Locator;
  readonly connectedMarker: Locator;
  readonly statusMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("account-kindle-card");
    this.heading = page.getByRole("heading", { level: 2, name: "Kindle" });
    this.emailField = page.getByTestId("kindle-email-input");
    this.saveButton = page.getByTestId("kindle-email-save");
    this.connectedMarker = page.getByTestId("kindle-email-connected");
    this.statusMessage = page.getByTestId("kindle-email-status");
  }

  async saveEmail(address: string): Promise<void> {
    await this.emailField.fill(address);
    await this.saveButton.click();
  }
}
