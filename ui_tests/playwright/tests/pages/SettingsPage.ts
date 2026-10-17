import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { accountUrls } from "../contracts/account";
import { isPostTo } from "../utils/api";
import { BasePage } from "./BasePage";

export class SettingsPage extends BasePage {
  protected readonly urlPattern = /\/settings(?:\?[^#]*)?$/;

  readonly topNav: TopNavComponent;

  readonly titleHeading: Locator;
  readonly scrollStopsSwitch: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.titleHeading = page.getByRole("heading", { level: 1 });
    this.scrollStopsSwitch = page.getByRole("switch", {
      name: "Use book details scroll stops",
    });
  }

  protected get readyLocator(): Locator {
    return this.titleHeading;
  }

  async goto(section: "account"): Promise<void> {
    await this.openAndSettle(`/settings?section=${section}`);
  }

  /** Flips the switch and waits for the save. */
  async toggleScrollStops(): Promise<void> {
    const saved = this.page.waitForResponse(isPostTo(accountUrls.scrollStops));
    await this.scrollStopsSwitch.click();
    await saved;
  }
}
