import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** Settings › Devices → KOReader progress sync: the password a stock KOReader signs in with. */
export class KosyncCardComponent extends BaseComponent {
  readonly card: Locator;
  readonly heading: Locator;
  readonly loading: Locator;
  readonly status: Locator;
  readonly generateButton: Locator;
  readonly revealed: Locator;
  readonly serverUrlField: Locator;
  readonly usernameField: Locator;
  readonly passwordField: Locator;
  readonly passwordCopyButton: Locator;
  readonly replaceDialog: Locator;
  readonly confirmReplaceButton: Locator;
  readonly cancelReplaceButton: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("kosync-card");
    this.heading = page.getByRole("heading", {
      level: 3,
      name: "KOReader progress sync",
    });
    this.loading = page.getByTestId("kosync-loading");
    this.status = page.getByTestId("kosync-status");
    this.generateButton = page.getByTestId("kosync-generate");
    this.revealed = page.getByTestId("kosync-revealed");
    this.serverUrlField = page.getByTestId("kosync-url");
    this.usernameField = page.getByTestId("kosync-username");
    this.passwordField = page.getByTestId("kosync-password");
    this.passwordCopyButton = page.getByTestId("kosync-password-copy");
    this.replaceDialog = page.getByTestId("kosync-replace-dialog");
    this.confirmReplaceButton = page.getByTestId(
      "kosync-replace-dialog-confirm",
    );
    this.cancelReplaceButton = page.getByTestId("kosync-replace-dialog-cancel");
  }

  /** Clicks generate; wrap it in `expectMutation` to assert the write. */
  async generate(): Promise<void> {
    await this.generateButton.click();
  }

  async cancelReplace(): Promise<void> {
    await this.cancelReplaceButton.click();
  }

  /** Confirms the replace dialog; wrap it in `expectMutation` to assert the write. */
  async confirmReplace(): Promise<void> {
    await this.confirmReplaceButton.click();
  }
}
