import type { Locator, Page } from "@playwright/test";
import { koboUrls } from "../contracts/kobo";
import type { KoboDeviceListing } from "../data/account";
import { recordRequests } from "../utils/api";
import { BaseComponent } from "./BaseComponent";

/** Settings › Devices → Kobo: the wireless-sync devices of the signed-in user. */
export class KoboSectionComponent extends BaseComponent {
  readonly devicesCard: Locator;
  readonly dataLossWarning: Locator;
  readonly setupToggle: Locator;
  readonly setupSteps: Locator;
  readonly shelvesLink: Locator;
  readonly emptyMessage: Locator;
  readonly deviceRows: Locator;
  readonly nameField: Locator;
  readonly addButton: Locator;
  readonly regenerateDialog: Locator;
  readonly cancelRegenerateButton: Locator;
  readonly removeDialog: Locator;
  readonly confirmRemoveButton: Locator;

  constructor(page: Page) {
    super(page);
    this.devicesCard = page.getByTestId("kobo-devices-card");
    this.dataLossWarning = page.getByTestId("kobo-data-loss-warning");
    this.setupToggle = page.getByText("How to connect a Kobo");
    this.setupSteps = page.getByTestId("kobo-setup-steps");
    this.shelvesLink = page.getByRole("link", {
      name: "Choose shelves to sync",
    });
    this.emptyMessage = page.getByTestId("kobo-devices-empty");
    this.deviceRows = page.getByTestId("kobo-device-row");
    this.nameField = page.getByTestId("kobo-device-name-input");
    this.addButton = page.getByTestId("kobo-device-add");
    this.regenerateDialog = page.getByTestId("kobo-regenerate-dialog");
    this.cancelRegenerateButton = page.getByTestId(
      "kobo-regenerate-dialog-cancel",
    );
    this.removeDialog = page.getByTestId("kobo-remove-dialog");
    this.confirmRemoveButton = page.getByTestId("kobo-remove-dialog-confirm");
  }

  deviceRow(name: string): Locator {
    return this.deviceRows.filter({ hasText: name });
  }

  endpointField(name: string): Locator {
    return this.deviceRow(name).getByTestId("kobo-endpoint-url");
  }

  /** The link to the community backup tool, inside the open setup steps. */
  backupToolLink(): Locator {
    return this.setupSteps.getByRole("link", {
      name: "omnibus-library/kobo-backup",
    });
  }

  /** The confirmation naming the device whose token would be replaced. */
  regenerateConfirmation(name: string): Locator {
    return this.page.getByRole("dialog", {
      name: `Regenerate the token for ${name}?`,
    });
  }

  /** The confirmation naming the device that would stop syncing. */
  removeConfirmation(name: string): Locator {
    return this.page.getByRole("dialog", { name: `Remove ${name}?` });
  }

  async addDevice(name: string): Promise<void> {
    await this.nameField.fill(name);
    await this.addButton.click();
  }

  async openSetupSteps(): Promise<void> {
    await this.setupToggle.click();
  }

  async startRegenerate(name: string): Promise<void> {
    await this.page
      .getByRole("button", { name: `Regenerate token for ${name}` })
      .click();
  }

  async cancelRegenerate(): Promise<void> {
    await this.cancelRegenerateButton.click();
  }

  /** The methods of every token regeneration sent from now on. */
  recordRegenerates(): string[] {
    return recordRequests(this.page, koboUrls.regenerate);
  }

  async startRemove(name: string): Promise<void> {
    await this.page.getByRole("button", { name: `Remove ${name}` }).click();
  }

  async confirmRemove(): Promise<void> {
    await this.confirmRemoveButton.click();
  }

  /** Answers the device list with `devices`, whatever the shared admin really holds. */
  async stubDevices(devices: KoboDeviceListing[]): Promise<void> {
    await this.page.route(koboUrls.list, (route) =>
      route.fulfill({
        status: 200,
        json: devices.map((device) => ({
          ...device,
          token: `tok-${device.id}`,
          created_at: 0,
          last_seen_at: 0,
        })),
      }),
    );
  }
}
