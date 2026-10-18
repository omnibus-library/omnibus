import type { Locator, Page } from "@playwright/test";
import { authUrls } from "../contracts/auth";
import { progressUrls } from "../contracts/progress";
import type { RecentPoint } from "../data/recentProgress";
import { expect } from "../fixtures/test";
import { BaseComponent } from "./BaseComponent";
import { SearchPaletteComponent } from "./SearchPaletteComponent";

/** A theme the user menu's segmented control offers. */
export type Theme = "dark" | "black" | "light";

/** The themes Preferences offers: the user menu's, plus sepia. */
export type PreferenceTheme = Theme | "sepia";

/** The primary navigation bar along the top of every web page. */
export class TopNavComponent extends BaseComponent {
  readonly root: Locator;
  readonly libraryLink: Locator;
  readonly checkInButton: Locator;
  readonly addBooksButton: Locator;
  readonly userMenuButton: Locator;
  readonly userMenuPanel: Locator;
  readonly searchButton: Locator;
  readonly searchPalette: SearchPaletteComponent;
  readonly breadcrumbNav: Locator;

  readonly shelvesLink: Locator;
  readonly signOutButton: Locator;
  readonly settingsLink: Locator;
  readonly adminLink: Locator;
  readonly editLink: Locator;
  readonly versionText: Locator;
  readonly nowReadingLink: Locator;
  readonly emptyProgressMessage: Locator;
  readonly piranesiText: Locator;
  readonly progressErrorMessage: Locator;
  readonly notificationsText: Locator;
  readonly serverHealthText: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByRole("navigation", { name: "Primary" });
    this.libraryLink = this.root.getByRole("link", { name: "Library" });
    this.checkInButton = this.root.getByRole("button", {
      name: "Check in",
      exact: true,
    });
    this.addBooksButton = page.getByTestId("add-books-button");
    this.userMenuButton = this.root.getByTestId("user-menu-trigger");
    this.userMenuPanel = page.getByTestId("user-menu-panel");
    this.searchButton = page.getByTestId("search-trigger");
    this.searchPalette = new SearchPaletteComponent(page, this.searchButton);
    // Absent on top-level pages.
    this.breadcrumbNav = page.locator("nav.breadcrumb");

    this.shelvesLink = this.root.getByRole("link", { name: "Shelves" });
    this.signOutButton = page.getByTestId("logout-button");
    this.settingsLink = page.getByRole("link", { name: "Settings" });
    this.adminLink = page.getByTestId("user-menu-admin");
    this.editLink = page.getByRole("link", { name: "Edit" });
    this.versionText = page.getByTestId("user-menu-version");
    this.nowReadingLink = page.getByTestId("user-menu-now-reading-action");
    this.emptyProgressMessage = page.getByText("Nothing in progress");
    this.piranesiText = page.getByText("Piranesi");
    this.progressErrorMessage = page.getByRole("alert");
    this.notificationsText = this.userMenuPanel.getByText("Notifications");
    this.serverHealthText = this.userMenuPanel.getByText("Server health");
  }

  async openLibrary(): Promise<void> {
    await this.libraryLink.click();
  }

  async openCheckIn(): Promise<void> {
    await this.checkInButton.click();
  }

  async openUserMenu(): Promise<void> {
    await this.userMenuButton.click();
  }

  /** A link in the bar, by its label. */
  navLink(name: "Authors" | "Series" | "Stats"): Locator {
    return this.root.getByRole("link", { name });
  }

  /** A link inside the open user menu. */
  userMenuLink(name: string): Locator {
    return this.userMenuPanel.getByRole("link", { name });
  }

  /** A theme button in the open user menu. */
  themeButton(theme: Theme): Locator {
    return this.page.getByTestId(`theme-${theme}`);
  }

  /** Follows a nav link, an in-app transition rather than a reload. */
  async open(name: "Authors" | "Series"): Promise<void> {
    await this.navLink(name).click();
    await this.page.waitForURL(new RegExp(`/${name.toLowerCase()}$`));
  }

  async openSettings(): Promise<void> {
    await this.settingsLink.click();
  }

  async openAdministration(): Promise<void> {
    await this.adminLink.click();
  }

  async editProfile(): Promise<void> {
    await this.editLink.click();
  }

  async signOut(): Promise<void> {
    await this.signOutButton.click();
  }

  async selectTheme(theme: Theme): Promise<void> {
    await this.themeButton(theme).click();
  }

  async closeUserMenuWithEscape(): Promise<void> {
    // Pressed on the panel itself so it cannot race the focus the menu takes on mount.
    await this.userMenuPanel.press("Escape");
  }

  /** Answers the menu's resume feed with `points` instead of the reader's own. */
  async stubRecentProgress(points: RecentPoint[]): Promise<void> {
    await this.page.route(progressUrls.recent, (route) =>
      route.fulfill({ status: 200, json: points }),
    );
  }

  /** Answers sign-out without ending the session, which every parallel test shares. */
  async stubSignOut(): Promise<void> {
    await this.page.route(authUrls.logout, (route) =>
      route.fulfill({ status: 200, contentType: "text/plain", body: "" }),
    );
  }

  /** The nav check every layout test makes: the bar and its fixed entries. */
  async assertDisplayed(): Promise<void> {
    await expect(this.root).toBeVisible();
    await expect(this.libraryLink).toBeVisible();
    await expect(this.userMenuButton).toBeVisible();
  }

  async openStats(): Promise<void> {
    await this.navLink("Stats").click();
  }
}
