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

  readonly account: AccountSectionComponent;
  readonly kindle: KindleSectionComponent;
  readonly kobo: KoboSectionComponent;
  readonly apiTokens: ApiTokensSectionComponent;

  readonly adminLink: Locator;

  constructor(page: Page) {
    super(page, {
      path: "/settings",
      layoutTestId: "settings-layout",
      title: "Settings",
      navTestId: "settings-nav",
    });
    this.account = new AccountSectionComponent(page);
    this.kindle = new KindleSectionComponent(page);
    this.kobo = new KoboSectionComponent(page);
    this.apiTokens = new ApiTokensSectionComponent(page);
    this.adminLink = page.getByTestId("settings-nav-admin");
  }
}
