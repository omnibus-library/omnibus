import type { Locator, Page } from "@playwright/test";
import { AccountSectionComponent } from "../components/AccountSectionComponent";
import { ApiTokensSectionComponent } from "../components/ApiTokensSectionComponent";
import { CleanupSectionComponent } from "../components/CleanupSectionComponent";
import { EmailSectionComponent } from "../components/EmailSectionComponent";
import { KindleSectionComponent } from "../components/KindleSectionComponent";
import { KoboSectionComponent } from "../components/KoboSectionComponent";
import { LibrarySectionComponent } from "../components/LibrarySectionComponent";
import { LogsSectionComponent } from "../components/LogsSectionComponent";
import { MetadataSectionComponent } from "../components/MetadataSectionComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { UsersSectionComponent } from "../components/UsersSectionComponent";
import { WorkerStatusComponent } from "../components/WorkerStatusComponent";
import { expect } from "../fixtures/test";
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

  /** Opens the old `/logs` address, which redirects into the Logs section. */
  async gotoLegacyLogs(): Promise<void> {
    await this.openAndSettle("/logs");
  }

  async openSection(section: SettingsSection): Promise<void> {
    await this.sectionLink(section).click();
  }

  /** Checks the address names `section`. */
  async assertSectionOpen(section: SettingsSection): Promise<void> {
    await expect(this.page).toHaveURL(
      new RegExp(`/settings\\?section=${section}$`),
    );
  }

  // #region batch-A: auth and account settings
  readonly kindle = new KindleSectionComponent(this.page);
  readonly kobo = new KoboSectionComponent(this.page);
  readonly apiTokens = new ApiTokensSectionComponent(this.page);

  /** Opens `/account`, the old route that redirects into Settings. */
  async gotoLegacyAccountRoute(): Promise<void> {
    await this.openAndSettle("/account");
  }
  // #endregion batch-A

  // #region batch-B: admin settings
  readonly library = new LibrarySectionComponent(this.page);
  readonly workerStatus = new WorkerStatusComponent(this.page);
  readonly metadata = new MetadataSectionComponent(this.page);
  readonly email = new EmailSectionComponent(this.page);
  readonly users = new UsersSectionComponent(this.page);
  readonly logs = new LogsSectionComponent(this.page);
  readonly cleanup = new CleanupSectionComponent(this.page);
  // The sidebar tour needs only these two cards of the Kindle and Kobo sections.
  readonly kindleCard = this.page.getByTestId("account-kindle-card");
  readonly koboDevicesCard = this.page.getByTestId("kobo-devices-card");
  // #endregion batch-B
}
