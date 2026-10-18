import type { Locator, Page } from "@playwright/test";
import { AccountSectionComponent } from "../components/AccountSectionComponent";
import { ApiTokensSectionComponent } from "../components/ApiTokensSectionComponent";
import { KindleSectionComponent } from "../components/KindleSectionComponent";
import { KoboSectionComponent } from "../components/KoboSectionComponent";
import { SettingsShellPage } from "./SettingsShellPage";

/** A `?section=` slug of the personal settings sidebar. */
export type SettingsSection =
  | "profile"
  | "preferences"
  | "goals"
  | "devices"
  | "security";

/** Personal settings at `/settings`: the reader's own sections, none of the server's. */
export class SettingsPage extends SettingsShellPage<SettingsSection> {
  protected readonly urlPattern = /\/settings(?:\?|$)/;

  readonly adminLink: Locator;

  readonly account = new AccountSectionComponent(this.page);
  readonly kindle = new KindleSectionComponent(this.page);
  readonly kobo = new KoboSectionComponent(this.page);
  readonly apiTokens = new ApiTokensSectionComponent(this.page);

  constructor(page: Page) {
    super(page, {
      path: "/settings",
      layoutTestId: "settings-layout",
      title: "Settings",
      navTestId: "settings-nav",
    });
    this.adminLink = page.getByTestId("settings-nav-admin");
  }

  /** Opens `/account`, the old route that redirects into Settings. */
  async gotoLegacyAccountRoute(): Promise<void> {
    await this.openAndSettle("/account");
  }
}
