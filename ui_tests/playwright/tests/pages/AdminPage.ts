import type { Locator, Page } from "@playwright/test";
import { CleanupSectionComponent } from "../components/CleanupSectionComponent";
import { HealthSectionComponent } from "../components/HealthSectionComponent";
import { IntegrationsSectionComponent } from "../components/IntegrationsSectionComponent";
import { LibrarySectionComponent } from "../components/LibrarySectionComponent";
import { LogsSectionComponent } from "../components/LogsSectionComponent";
import { MaintenanceSectionComponent } from "../components/MaintenanceSectionComponent";
import { MetadataSectionComponent } from "../components/MetadataSectionComponent";
import { UsersSectionComponent } from "../components/UsersSectionComponent";
import { WorkerStatusComponent } from "../components/WorkerStatusComponent";
import { SettingsShellPage } from "./SettingsShellPage";

/** A `?section=` slug of the administration sidebar. */
export type AdminSection =
  | "sources"
  | "maintenance"
  | "metadata"
  | "cleanup"
  | "people"
  | "integrations"
  | "health"
  | "logs";

/** Server administration at `/admin`: the sections an administrator owns. */
export class AdminPage extends SettingsShellPage<AdminSection> {
  protected readonly urlPattern = /\/admin(?:\?|$)/;

  readonly forbiddenNotice: Locator;
  readonly settingsLink: Locator;

  readonly library = new LibrarySectionComponent(this.page);
  readonly maintenance = new MaintenanceSectionComponent(this.page);
  readonly workerStatus = new WorkerStatusComponent(this.page);
  readonly metadata = new MetadataSectionComponent(this.page);
  readonly cleanup = new CleanupSectionComponent(this.page);
  readonly users = new UsersSectionComponent(this.page);
  readonly integrations = new IntegrationsSectionComponent(this.page);
  readonly health = new HealthSectionComponent(this.page);
  readonly logs = new LogsSectionComponent(this.page);

  constructor(page: Page) {
    super(page, {
      path: "/admin",
      layoutTestId: "admin-layout",
      title: "Administration",
      navTestId: "admin-nav",
    });
    this.forbiddenNotice = page.getByTestId("admin-forbidden");
    this.settingsLink = page.getByTestId("admin-nav-settings");
  }

  /** Opens an address that predates Administration, which redirects into it. */
  async gotoLegacy(path: string): Promise<void> {
    await this.openAndSettle(path);
  }
}
