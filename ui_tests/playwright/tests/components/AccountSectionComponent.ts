import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The per-user feature switches in Settings → Account. */
export class AccountSectionComponent extends BaseComponent {
  readonly scrollStopsSwitch: Locator;
  readonly shareStatsSwitch: Locator;

  constructor(page: Page) {
    super(page);
    this.scrollStopsSwitch = page.getByRole("switch", {
      name: "Use book details scroll stops",
    });
    this.shareStatsSwitch = page.getByRole("switch", {
      name: "Share stats with household",
    });
  }

  async toggleScrollStops(): Promise<void> {
    await this.scrollStopsSwitch.click();
  }

  async toggleShareStats(): Promise<void> {
    await this.shareStatsSwitch.click();
  }
}
