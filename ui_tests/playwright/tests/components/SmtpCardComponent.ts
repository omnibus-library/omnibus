import type { Locator, Page } from "@playwright/test";
import { settingsUrls } from "../contracts/settings";
import type { SmtpSettings } from "../data/settings";
import { recordRequests } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

const configuredRelay = {
  configured: true,
  host: "smtp.example.com",
  port: 587,
  username: null,
  from_email: "library@example.com",
  security: "starttls",
  password_masked: "s3…ss",
  source: "settings",
};

/** Administration › Integrations → the SMTP relay Send-to-Kindle goes through. */
export class SmtpCardComponent extends BaseComponent {
  readonly card: Locator;
  readonly hostField: Locator;
  readonly fromEmailField: Locator;
  readonly passwordField: Locator;
  readonly saveButton: Locator;
  readonly saveStatus: Locator;
  readonly configuredStatus: Locator;
  readonly clearButton: Locator;
  readonly clearDialog: Locator;
  readonly cancelClearButton: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("smtp-card");
    this.hostField = page.getByLabel("SMTP host");
    this.fromEmailField = page.getByLabel("From address");
    this.passwordField = page.getByLabel("Password");
    this.saveButton = page.getByTestId("smtp-save");
    this.saveStatus = page.getByTestId("smtp-config-status");
    this.configuredStatus = page.getByTestId("smtp-status");
    this.clearButton = page.getByTestId("smtp-clear");
    this.clearDialog = page.getByTestId("smtp-clear-dialog");
    this.cancelClearButton = page.getByTestId("smtp-clear-dialog-cancel");
  }

  async fillForm({ host, fromEmail, password }: SmtpSettings): Promise<void> {
    await this.hostField.fill(host);
    await this.fromEmailField.fill(fromEmail);
    await this.passwordField.fill(password);
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }

  async startClear(): Promise<void> {
    await this.clearButton.click();
  }

  async cancelClear(): Promise<void> {
    await this.cancelClearButton.click();
  }

  /** The methods of every clear sent from now on. */
  recordClears(): string[] {
    return recordRequests(this.page, settingsUrls.smtpClear);
  }

  /** Answers a save with a masked, configured status and writes nothing. */
  async stubSaved(): Promise<void> {
    await this.page.route(settingsUrls.smtp, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(configuredRelay),
          })
        : route.continue(),
    );
  }

  /** Answers the read as configured, since that is instance state to leave alone. */
  async stubConfigured(): Promise<void> {
    await this.page.route(settingsUrls.smtp, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: configuredRelay })
        : route.continue(),
    );
  }
}
