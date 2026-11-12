import type { Locator, Page } from "@playwright/test";
import type { NtfyAuth } from "../data/notifications";
import { BaseComponent } from "./BaseComponent";

/** What the add form needs for an ntfy connection signed in with a token. */
export type TokenConnectionFields = {
  name: string;
  serverUrl: string;
  topic: string;
  token: string;
};

/** Administration › Notifications → the dialog that adds or edits an ntfy connection, and tests it. */
export class NotificationConnectionModalComponent extends BaseComponent {
  readonly dialog: Locator;
  readonly nameField: Locator;
  readonly serverUrlField: Locator;
  readonly topicField: Locator;
  readonly signInSelect: Locator;
  readonly tokenField: Locator;
  /** "A token is saved", shown in place of the token itself. */
  readonly savedTokenStatus: Locator;
  readonly testButton: Locator;
  readonly saveButton: Locator;
  readonly testStatus: Locator;
  readonly formError: Locator;

  constructor(page: Page) {
    super(page);
    this.dialog = page.getByTestId("notification-connection-modal");
    this.nameField = this.dialog.getByLabel("Name", { exact: true });
    this.serverUrlField = this.dialog.getByLabel("Server URL");
    this.topicField = this.dialog.getByLabel("Topic");
    this.signInSelect = this.dialog.getByLabel("Sign-in");
    this.tokenField = this.dialog.getByLabel("Access token");
    this.savedTokenStatus = this.dialog.getByTestId("notify-token-status");
    this.testButton = this.dialog.getByRole("button", { name: "Send test" });
    this.saveButton = this.dialog.getByRole("button", {
      name: "Save connection",
    });
    this.testStatus = this.dialog.getByTestId("notify-test-status");
    this.formError = this.dialog.getByTestId("notify-form-error");
  }

  /** Fills the server and topic, all a test needs. */
  async fillServer(serverUrl: string, topic: string): Promise<void> {
    await this.serverUrlField.fill(serverUrl);
    await this.topicField.fill(topic);
  }

  async chooseSignIn(mode: NtfyAuth): Promise<void> {
    await this.signInSelect.selectOption(mode);
  }

  async fillTokenConnection(fields: TokenConnectionFields): Promise<void> {
    await this.nameField.fill(fields.name);
    await this.fillServer(fields.serverUrl, fields.topic);
    await this.chooseSignIn("token");
    await this.tokenField.fill(fields.token);
  }

  async rename(name: string): Promise<void> {
    await this.nameField.fill(name);
  }

  async sendTest(): Promise<void> {
    await this.testButton.click();
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }
}
