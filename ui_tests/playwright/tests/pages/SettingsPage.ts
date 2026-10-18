import type { Locator, Page } from "@playwright/test";
import { AccountSectionComponent } from "../components/AccountSectionComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { BasePage } from "./BasePage";

/** A `?section=` slug of the settings sidebar. */
export type SettingsSection =
  | "account"
  | "kindle"
  | "kobo"
  | "api-tokens"
  | "library"
  | "metadata"
  | "email"
  | "users"
  | "logs"
  | "cleanup";

/** The settings frame at `/settings`: a sidebar and the section it selects. */
export class SettingsPage extends BasePage {
  protected readonly urlPattern = /\/settings(?:\?|$)/;

  readonly topNav: TopNavComponent;
  readonly account: AccountSectionComponent;

  readonly layout: Locator;
  readonly heading: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.account = new AccountSectionComponent(page);
    this.layout = page.getByTestId("settings-layout");
    this.heading = page.getByRole("heading", { level: 1, name: "Settings" });
  }

  protected get readyLocator(): Locator {
    return this.layout;
  }

  /** The sidebar link to `section`. */
  sectionLink(section: SettingsSection): Locator {
    return this.page.getByTestId(`settings-nav-${section}`);
  }

  async goto(section?: SettingsSection): Promise<void> {
    await this.openAndSettle(
      section === undefined ? "/settings" : `/settings?section=${section}`,
    );
  }

  // #region batch-A: auth and account settings
  // #endregion batch-A

  // #region batch-B: admin settings
  // #endregion batch-B
}
