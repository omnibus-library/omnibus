import type { Locator, Page } from "@playwright/test";
import { accountUrls } from "../contracts/account";
import { recordRequests } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** Settings › Devices → Kindle: the Send-to-Kindle address and who to approve. */
export class KindleSectionComponent extends BaseComponent {
  readonly card: Locator;
  readonly heading: Locator;
  readonly emailField: Locator;
  readonly saveButton: Locator;
  readonly connectedMarker: Locator;
  readonly statusMessage: Locator;
  readonly delivery: Locator;
  readonly senderCopyButton: Locator;
  readonly emailDeliveryLink: Locator;
  readonly clearButton: Locator;
  readonly clearDialog: Locator;
  readonly cancelClearButton: Locator;
  readonly confirmClearButton: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("account-kindle-card");
    this.heading = page.getByRole("heading", { level: 3, name: "Kindle" });
    this.emailField = page.getByTestId("kindle-email-input");
    this.saveButton = page.getByRole("button", { name: "Save Kindle email" });
    this.connectedMarker = page.getByTestId("kindle-email-connected");
    this.statusMessage = page.getByTestId("kindle-email-status");
    this.delivery = page.getByTestId("kindle-delivery");
    this.senderCopyButton = page.getByTestId("kindle-sender-copy");
    this.emailDeliveryLink = page.getByRole("link", {
      name: "Set up email delivery",
    });
    this.clearButton = page.getByTestId("kindle-email-clear");
    this.clearDialog = page.getByTestId("kindle-email-clear-dialog");
    this.cancelClearButton = page.getByTestId(
      "kindle-email-clear-dialog-cancel",
    );
    this.confirmClearButton = page.getByTestId(
      "kindle-email-clear-dialog-confirm",
    );
  }

  async saveEmail(address: string): Promise<void> {
    await this.emailField.fill(address);
    await this.saveButton.click();
  }

  async startClear(): Promise<void> {
    await this.clearButton.click();
  }

  async cancelClear(): Promise<void> {
    await this.cancelClearButton.click();
  }

  async confirmClear(): Promise<void> {
    await this.confirmClearButton.click();
  }

  /** The methods of every address write sent from now on. */
  recordEmailWrites(): string[] {
    return recordRequests(this.page, accountUrls.kindleEmail);
  }

  /** Answers the delivery read; readiness is instance configuration (an SMTP relay). */
  async stubDelivery(senderAddress: string | null): Promise<void> {
    await this.page.route(accountUrls.kindleDelivery, (route) =>
      route.fulfill({ status: 200, json: { sender_address: senderAddress } }),
    );
  }
}
