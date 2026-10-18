import type { Locator, Page } from "@playwright/test";
import { CleanupSectionComponent } from "../components/CleanupSectionComponent";
import { HealthSectionComponent } from "../components/HealthSectionComponent";
import { IntegrationsSectionComponent } from "../components/IntegrationsSectionComponent";
import { LibrarySectionComponent } from "../components/LibrarySectionComponent";
import { LogsSectionComponent } from "../components/LogsSectionComponent";
import { MaintenanceSectionComponent } from "../components/MaintenanceSectionComponent";
import { MetadataSectionComponent } from "../components/MetadataSectionComponent";
import { UsersSectionComponent } from "../components/UsersSectionComponent";
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
  readonly library: LibrarySectionComponent;
  readonly maintenance: MaintenanceSectionComponent;
  readonly metadata: MetadataSectionComponent;
  readonly cleanup: CleanupSectionComponent;
  readonly users: UsersSectionComponent;
  readonly integrations: IntegrationsSectionComponent;
  readonly health: HealthSectionComponent;
  readonly logs: LogsSectionComponent;

  readonly forbiddenNotice: Locator;
  readonly settingsLink: Locator;

  constructor(page: Page) {
    super(page, {
      path: "/admin",
      layoutTestId: "admin-layout",
      title: "Administration",
      navTestId: "admin-nav",
    });
    this.library = new LibrarySectionComponent(page);
    this.maintenance = new MaintenanceSectionComponent(page);
    this.metadata = new MetadataSectionComponent(page);
    this.cleanup = new CleanupSectionComponent(page);
    this.users = new UsersSectionComponent(page);
    this.integrations = new IntegrationsSectionComponent(page);
    this.health = new HealthSectionComponent(page);
    this.logs = new LogsSectionComponent(page);
    this.forbiddenNotice = page.getByTestId("admin-forbidden");
    this.settingsLink = page.getByTestId("admin-nav-settings");
  }
}
