import type { Locator, Page } from "@playwright/test";
import { koboUrls } from "../contracts/kobo";
import type { KoboDeviceListing } from "../data/account";
import { BaseComponent } from "./BaseComponent";

/** Settings › Devices → KOReader: the plugin KOReaders of the signed-in user. */
export class KoreaderCardComponent extends BaseComponent {
  readonly card: Locator;
  readonly dataLossWarning: Locator;
  readonly setupToggle: Locator;
  readonly setupSteps: Locator;
  readonly shelvesLink: Locator;
  readonly emptyMessage: Locator;
  readonly statusMessage: Locator;
  readonly deviceRows: Locator;
  readonly nameField: Locator;
  readonly addButton: Locator;
  readonly confirmRemoveButton: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.getByTestId("koreader-devices-card");
    this.dataLossWarning = this.card.getByTestId("kobo-data-loss-warning");
    this.setupToggle = this.card.getByText("How to connect a KOReader");
    this.setupSteps = page.getByTestId("koreader-setup-steps");
    this.shelvesLink = this.card.getByRole("link", {
      name: "Choose shelves to sync",
    });
    this.emptyMessage = page.getByTestId("koreader-devices-empty");
    this.statusMessage = page.getByTestId("koreader-devices-status");
    this.deviceRows = page.getByTestId("koreader-device-row");
    this.nameField = page.getByTestId("koreader-device-name-input");
    this.addButton = page.getByTestId("koreader-device-add");
    this.confirmRemoveButton = page.getByTestId(
      "koreader-remove-dialog-confirm",
    );
  }

  deviceRow(name: string): Locator {
    return this.deviceRows.filter({ hasText: name });
  }

  /** The badge beside a row's name: "Not synced yet" until the plugin first reports. */
  badge(name: string): Locator {
    return this.deviceRow(name).getByTestId("koreader-device-badge");
  }

  /** A plugin row's token field, which a KOReader row no longer shows. */
  tokenField(name: string): Locator {
    return this.deviceRow(name).getByTestId("koreader-device-token");
  }

  /** A KOReader row's Download plugin link. */
  pluginDownload(name: string): Locator {
    return this.deviceRow(name).getByTestId("koreader-plugin-download");
  }

  /** Clicks a KOReader's Download plugin link; the file name the browser saves it under. */
  async downloadPlugin(name: string): Promise<string> {
    const download = this.page.waitForEvent("download");
    await this.pluginDownload(name).click();
    return (await download).suggestedFilename();
  }

  /** A KOReader row's last-sync line. */
  lastSync(name: string): Locator {
    return this.deviceRow(name).getByTestId("koreader-last-sync");
  }

  removeButton(name: string): Locator {
    return this.page.getByRole("button", { name: `Remove ${name}` });
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

  async startRemove(name: string): Promise<void> {
    await this.removeButton(name).click();
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
          kind: "koreader",
          ...device,
          token: `tok-${device.id}`,
          created_at: 0,
          last_seen_at: 0,
        })),
      }),
    );
  }
}
