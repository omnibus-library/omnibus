import type { Locator, Page } from "@playwright/test";
import { settingsUrls } from "../contracts/settings";
import type { SmtpSettings } from "../data/settings";
import { BaseComponent } from "./BaseComponent";

/** Settings → Email delivery: the SMTP relay Send-to-Kindle goes through. */
export class EmailSectionComponent extends BaseComponent {
  readonly card: Locator;
  readonly hostField: Locator;
  readonly fromEmailField: Locator;
  readonly passwordField: Locator;
  readonly saveButton: Locator;
  readonly saveStatus: Locator;
  readonly configuredStatus: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("smtp-card");
    this.hostField = page.getByLabel("SMTP Host");
    this.fromEmailField = page.getByLabel("From Email");
    this.passwordField = page.getByLabel("Password");
    this.saveButton = page.getByTestId("smtp-save");
    this.saveStatus = page.getByTestId("smtp-config-status");
    this.configuredStatus = page.getByTestId("smtp-status");
  }

  async fillForm({ host, fromEmail, password }: SmtpSettings): Promise<void> {
    await this.hostField.fill(host);
    await this.fromEmailField.fill(fromEmail);
    await this.passwordField.fill(password);
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }

  /** Answers a save with a masked, configured status and writes nothing. */
  async stubSaved(): Promise<void> {
    await this.page.route(settingsUrls.smtp, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              configured: true,
              host: "smtp.example.com",
              port: 587,
              username: null,
              from_email: "library@example.com",
              security: "starttls",
              password_masked: "s3…ss",
              source: "settings",
            }),
          })
        : route.continue(),
    );
  }
}
