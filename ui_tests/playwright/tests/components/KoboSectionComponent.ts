import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** Settings → Kobo: the wireless-sync devices of the signed-in user. */
export class KoboSectionComponent extends BaseComponent {
  readonly devicesCard: Locator;
  readonly nameField: Locator;
  readonly addButton: Locator;

  constructor(page: Page) {
    super(page);
    this.devicesCard = page.getByTestId("kobo-devices-card");
    this.nameField = page.getByTestId("kobo-device-name-input");
    this.addButton = page.getByTestId("kobo-device-add");
  }

  deviceRow(name: string): Locator {
    return this.page.getByTestId("kobo-device-row").filter({ hasText: name });
  }

  endpointField(name: string): Locator {
    return this.deviceRow(name).getByTestId("kobo-endpoint-url");
  }

  async addDevice(name: string): Promise<void> {
    await this.nameField.fill(name);
    await this.addButton.click();
  }

  async removeDevice(name: string): Promise<void> {
    await this.deviceRow(name).getByTestId("kobo-device-remove").click();
  }
}
