import type { Locator, Page } from "@playwright/test";
import { accountUrls } from "../contracts/account";
import { TINY_PNG } from "../data/covers";
import { recordRequests } from "../utils/api";
import { BaseComponent } from "./BaseComponent";
import type { Theme } from "./TopNavComponent";

/** A reading goal's kind, as the goals form names its fields. */
export type GoalKind = "books" | "pages" | "minutes";

/** The themes Preferences offers: the user menu's, plus sepia. */
export type PreferenceTheme = Theme | "sepia";

/**
 * The reader's own controls across Settings: the profile, the preferences
 * (switches and hidden formats), the goals form and the password card.
 */
export class AccountSectionComponent extends BaseComponent {
  readonly profileCard: Locator;
  readonly profileHeading: Locator;
  readonly displayNameField: Locator;
  readonly saveDisplayNameButton: Locator;
  readonly profileStatus: Locator;
  readonly avatarFileInput: Locator;
  readonly avatarStatus: Locator;

  readonly passwordHeading: Locator;
  readonly passwordCard: Locator;
  readonly currentPasswordField: Locator;
  readonly newPasswordField: Locator;
  readonly changePasswordButton: Locator;
  readonly passwordStatus: Locator;
  readonly sessionsCard: Locator;
  readonly sessionRevokeDialog: Locator;
  readonly cancelSessionRevokeButton: Locator;

  readonly deviceNote: Locator;
  readonly stackSeriesSwitch: Locator;
  readonly scrollStopsSwitch: Locator;
  readonly shareStatsRow: Locator;
  readonly shareStatsSwitch: Locator;
  readonly shareStatsStatus: Locator;

  readonly goalsCard: Locator;
  readonly goalsHeading: Locator;
  readonly goalsCardButtons: Locator;
  readonly saveGoalsButton: Locator;
  readonly goalsStatus: Locator;

  readonly hiddenFormatsCard: Locator;
  readonly hiddenFormatsGroup: Locator;
  readonly saveHiddenFormatsButton: Locator;
  readonly hiddenFormatsStatus: Locator;

  constructor(page: Page) {
    super(page);
    this.profileCard = page.getByTestId("account-profile-card");
    this.profileHeading = page.getByRole("heading", {
      level: 3,
      name: "Profile",
    });
    this.displayNameField = page.getByTestId("display-name-input");
    this.saveDisplayNameButton = page.getByTestId("display-name-save");
    this.profileStatus = page.getByTestId("profile-status");
    this.avatarFileInput = page.getByTestId("avatar-file-input");
    this.avatarStatus = page.getByTestId("avatar-status");

    this.passwordHeading = page.getByRole("heading", {
      level: 3,
      name: "Password",
    });
    this.passwordCard = page.getByTestId("account-password-card");
    this.currentPasswordField = page.getByTestId("current-password-input");
    this.newPasswordField = page.getByTestId("new-password-input");
    this.changePasswordButton = page.getByTestId("change-password-submit");
    this.passwordStatus = page.getByTestId("change-password-status");
    this.sessionsCard = page.getByTestId("account-sessions-card");
    this.sessionRevokeDialog = page.getByTestId("session-revoke-dialog");
    this.cancelSessionRevokeButton = page.getByTestId(
      "session-revoke-dialog-cancel",
    );

    this.deviceNote = page.getByText("Applies to this device.");
    this.stackSeriesSwitch = page.getByRole("switch", { name: "Stack series" });
    this.scrollStopsSwitch = page.getByRole("switch", { name: "Scroll stops" });
    this.shareStatsRow = page.getByTestId("user-setting-share-stats");
    this.shareStatsSwitch = page.getByRole("switch", {
      name: "Share stats with household",
    });
    this.shareStatsStatus = page.getByTestId("share-stats-status");

    this.goalsCard = page.getByTestId("account-goals-card");
    this.goalsHeading = this.goalsCard.getByRole("heading", {
      level: 3,
      name: "Reading goals",
    });
    this.goalsCardButtons = this.goalsCard.getByRole("button");
    this.saveGoalsButton = page.getByTestId("goals-save");
    this.goalsStatus = page.getByTestId("goals-status");

    this.hiddenFormatsCard = page.getByTestId("account-hidden-formats-card");
    this.hiddenFormatsGroup = page.getByRole("group", {
      name: "Hidden formats",
    });
    this.saveHiddenFormatsButton = page.getByTestId("hidden-formats-save");
    this.hiddenFormatsStatus = page.getByTestId("hidden-formats-status");
  }

  /** A group of the preferences, such as Appearance or Privacy. */
  preferenceGroup(name: string): Locator {
    return this.page.getByRole("heading", { level: 3, name });
  }

  /** A theme button of the Appearance group. */
  themeButton(theme: PreferenceTheme): Locator {
    return this.page.getByTestId(`theme-${theme}`);
  }

  goalField(kind: GoalKind): Locator {
    return this.page.getByTestId(`goal-${kind}-input`);
  }

  /** The message under a goal field the form refused or failed to save. */
  goalError(kind: GoalKind): Locator {
    return this.page.getByTestId(`goal-${kind}-error`);
  }

  hiddenFormatToggle(format: string): Locator {
    return this.page.getByTestId(`hidden-format-toggle-${format}`);
  }

  /** The button that revokes the session `client` signed in from. */
  revokeSessionButton(client: string): Locator {
    return this.page.getByRole("button", {
      name: `Revoke the session on ${client}`,
    });
  }

  async selectTheme(theme: PreferenceTheme): Promise<void> {
    await this.themeButton(theme).click();
  }

  async toggleScrollStops(): Promise<void> {
    await this.scrollStopsSwitch.click();
  }

  async toggleShareStats(): Promise<void> {
    await this.shareStatsSwitch.click();
  }

  async fillDisplayName(displayName: string): Promise<void> {
    await this.displayNameField.fill(displayName);
  }

  async saveDisplayName(displayName: string): Promise<void> {
    await this.fillDisplayName(displayName);
    await this.saveDisplayNameButton.click();
  }

  /** Puts keyboard focus on the picture picker, which is visually hidden. */
  async focusAvatarPicker(): Promise<void> {
    await this.avatarFileInput.focus();
  }

  async uploadAvatar(): Promise<void> {
    await this.avatarFileInput.setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
  }

  /** Types both fields and submits; the form shows what came back. */
  async changePassword(current: string, replacement: string): Promise<void> {
    await this.currentPasswordField.fill(current);
    await this.newPasswordField.fill(replacement);
    await this.changePasswordButton.click();
  }

  async startRevokeSession(client: string): Promise<void> {
    await this.revokeSessionButton(client).click();
  }

  async cancelSessionRevoke(): Promise<void> {
    await this.cancelSessionRevokeButton.click();
  }

  /** The methods of every session revoke sent from now on. */
  recordSessionRevokes(): string[] {
    return recordRequests(this.page, accountUrls.sessionRevoke);
  }

  async fillGoal(kind: GoalKind, target: string): Promise<void> {
    await this.goalField(kind).fill(target);
  }

  async saveGoals(): Promise<void> {
    await this.saveGoalsButton.click();
  }

  async setFormatHidden(format: string, hidden: boolean): Promise<void> {
    await this.hiddenFormatToggle(format).setChecked(hidden);
  }

  /** A plain click, for a box that leaves the list once unhidden. */
  async toggleHiddenFormat(format: string): Promise<void> {
    await this.hiddenFormatToggle(format).click();
  }

  /** Answers the upload with `status`; a real picture would show in every other spec's menu. */
  async stubAvatarUpload(status: number): Promise<void> {
    await this.page.route(accountUrls.avatar, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status, body: "" })
        : route.continue(),
    );
  }

  /** Answers the change with success; a real one would strand every later sign-in. */
  async stubPasswordChanged(): Promise<void> {
    await this.page.route(accountUrls.changePassword, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "null",
          })
        : route.continue(),
    );
  }

  /**
   * Lists the signed-in session and one other. The admin's real sessions are
   * shared by every spec, so the list is stubbed rather than revoked from.
   */
  async stubSessions(otherClient: string): Promise<void> {
    const session = { kind: "cookie", created_at: 1, last_used_at: 1 };
    await this.page.route(accountUrls.sessions, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            json: [
              {
                ...session,
                id: 1,
                client: "Firefox on Linux",
                expires_at: 4e9,
                is_current: true,
              },
              {
                ...session,
                id: 2,
                client: otherClient,
                expires_at: 4e9,
                is_current: false,
              },
            ],
          })
        : route.continue(),
    );
  }
}
