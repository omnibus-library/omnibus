import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";
import { NotificationConnectionModalComponent } from "./NotificationConnectionModalComponent";

/** Administration › Notifications: the public server URL, and the ntfy connections the server tells. */
export class NotificationsSectionComponent extends BaseComponent {
  readonly publicUrlCard: Locator;
  readonly publicUrlField: Locator;
  readonly savePublicUrlButton: Locator;
  readonly clearPublicUrlButton: Locator;
  /** Where the URL in effect came from: saved here, the environment, or not set. */
  readonly publicUrlSource: Locator;
  /** The server's reason for refusing a URL, beside the field. */
  readonly publicUrlError: Locator;
  readonly publicUrlSaveStatus: Locator;
  readonly connectionsCard: Locator;
  readonly addButton: Locator;
  readonly status: Locator;
  readonly deleteDialog: Locator;
  readonly confirmDeleteButton: Locator;
  readonly modal: NotificationConnectionModalComponent;

  constructor(page: Page) {
    super(page);
    this.publicUrlCard = page.getByTestId("public-url-card");
    this.publicUrlField = this.publicUrlCard.getByLabel("Public server URL");
    this.savePublicUrlButton = this.publicUrlCard.getByRole("button", {
      name: "Save public URL",
    });
    this.clearPublicUrlButton = this.publicUrlCard.getByRole("button", {
      name: "Clear saved URL",
    });
    this.publicUrlSource = page.getByTestId("public-url-status");
    this.publicUrlError = this.publicUrlCard.getByRole("alert");
    this.publicUrlSaveStatus = page.getByTestId("public-url-save-status");
    this.connectionsCard = page.getByTestId("notification-connections-card");
    this.addButton = this.connectionsCard.getByRole("button", {
      name: "Add connection",
    });
    this.status = page.getByTestId("notifications-status");
    this.deleteDialog = page.getByTestId("notification-delete-dialog");
    this.confirmDeleteButton = page.getByTestId(
      "notification-delete-dialog-confirm",
    );
    this.modal = new NotificationConnectionModalComponent(page);
  }

  /** The list row of the connection called `name`. */
  row(name: string): Locator {
    return this.connectionsCard.getByRole("listitem", { name, exact: true });
  }

  /** The on/off switch of the connection called `name`. */
  rowSwitch(name: string): Locator {
    return this.row(name).getByRole("switch", {
      name: `Send notifications to ${name}`,
    });
  }

  /** The result of the last action on `name`'s row, such as its Test. */
  rowStatus(name: string): Locator {
    return this.row(name).getByTestId("notification-row-status");
  }

  /** How the last notification to `name` went: "No deliveries yet", "Delivered …", "Failed …". */
  rowLastDelivery(name: string): Locator {
    return this.row(name).getByTestId("notification-last-delivery");
  }

  async fillPublicUrl(url: string): Promise<void> {
    await this.publicUrlField.fill(url);
  }

  async savePublicUrl(): Promise<void> {
    await this.savePublicUrlButton.click();
  }

  async clearPublicUrl(): Promise<void> {
    await this.clearPublicUrlButton.click();
  }

  /** Sends a test through `name` as saved, from its row. */
  async testRow(name: string): Promise<void> {
    await this.row(name)
      .getByRole("button", { name: `Test ${name}`, exact: true })
      .click();
  }

  async startAdding(): Promise<void> {
    await this.addButton.click();
  }

  async edit(name: string): Promise<void> {
    await this.row(name)
      .getByRole("button", { name: `Edit ${name}`, exact: true })
      .click();
  }

  async flip(name: string): Promise<void> {
    await this.rowSwitch(name).click();
  }

  async startDeleting(name: string): Promise<void> {
    await this.row(name)
      .getByRole("button", { name: `Delete ${name}`, exact: true })
      .click();
  }

  async confirmDelete(): Promise<void> {
    await this.confirmDeleteButton.click();
  }
}
