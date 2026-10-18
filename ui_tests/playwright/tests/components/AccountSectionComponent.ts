import type { Locator, Page } from "@playwright/test";
import { accountUrls } from "../contracts/account";
import { TINY_PNG } from "../data/covers";
import { BaseComponent } from "./BaseComponent";

/** A reading goal's kind, as the goals card names its fields. */
export type GoalKind = "books" | "pages" | "minutes";

/** Settings → Account: profile, password, feature switches, goals and hidden formats. */
export class AccountSectionComponent extends BaseComponent {
  readonly profileCard: Locator;
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

  readonly userSettingsCard: Locator;
  readonly userSettingsHeading: Locator;
  readonly userSettingsTable: Locator;
  readonly scrollStopsRow: Locator;
  readonly scrollStopsSwitch: Locator;
  readonly scrollStopsSoonNote: Locator;
  readonly shareStatsRow: Locator;
  readonly shareStatsSwitch: Locator;
  readonly shareStatsError: Locator;

  readonly goalsCard: Locator;
  readonly goalsHeading: Locator;
  readonly goalsCardButtons: Locator;
  readonly editGoalsButton: Locator;
  readonly saveGoalsButton: Locator;
  readonly cancelGoalsButton: Locator;
  readonly goalsStatus: Locator;

  readonly hiddenFormatsCard: Locator;
  readonly hiddenFormatsHeading: Locator;
  readonly saveHiddenFormatsButton: Locator;
  readonly hiddenFormatsStatus: Locator;

  constructor(page: Page) {
    super(page);
    this.profileCard = page.getByTestId("account-profile-card");
    this.displayNameField = page.getByTestId("display-name-input");
    this.saveDisplayNameButton = page.getByTestId("display-name-save");
    this.profileStatus = page.getByTestId("profile-status");
    this.avatarFileInput = page.getByTestId("avatar-file-input");
    this.avatarStatus = page.getByTestId("avatar-status");

    this.passwordHeading = page.getByRole("heading", {
      level: 2,
      name: "Password",
    });
    this.passwordCard = page.getByTestId("account-password-card");
    this.currentPasswordField = page.getByTestId("current-password-input");
    this.newPasswordField = page.getByTestId("new-password-input");
    this.changePasswordButton = page.getByTestId("change-password-submit");
    this.passwordStatus = page.getByTestId("change-password-status");

    this.userSettingsCard = page.getByTestId("account-user-settings-card");
    this.userSettingsHeading = page.getByRole("heading", {
      level: 2,
      name: "Omnibus User Settings",
    });
    this.userSettingsTable = page.getByTestId("user-settings-table");
    this.scrollStopsRow = page.getByTestId("user-setting-scroll-stops");
    this.scrollStopsSwitch = page.getByRole("switch", {
      name: "Use book details scroll stops",
    });
    this.scrollStopsSoonNote = page.getByTestId("scroll-stops-soon");
    this.shareStatsRow = page.getByTestId("user-setting-share-stats");
    this.shareStatsSwitch = page.getByRole("switch", {
      name: "Share stats with household",
    });
    this.shareStatsError = page.getByTestId("share-stats-error");

    this.goalsCard = page.getByTestId("account-goals-card");
    this.goalsHeading = page.getByRole("heading", {
      level: 2,
      name: "Reading goals",
    });
    this.goalsCardButtons = this.goalsCard.getByRole("button");
    this.editGoalsButton = page.getByTestId("goals-edit");
    this.saveGoalsButton = page.getByTestId("goals-save");
    this.cancelGoalsButton = page.getByTestId("goals-cancel");
    this.goalsStatus = page.getByTestId("goals-status");

    this.hiddenFormatsCard = page.getByTestId("account-hidden-formats-card");
    this.hiddenFormatsHeading = page.getByRole("heading", {
      level: 2,
      name: "Hidden formats",
    });
    this.saveHiddenFormatsButton = page.getByTestId("hidden-formats-save");
    this.hiddenFormatsStatus = page.getByTestId("hidden-formats-status");
  }

  /** The current value of one goal, which reads "Not set" until it has a target. */
  goalValue(kind: GoalKind): Locator {
    return this.page.getByTestId(`goal-${kind}-value`);
  }

  goalField(kind: GoalKind): Locator {
    return this.page.getByTestId(`goal-${kind}-input`);
  }

  hiddenFormatToggle(format: string): Locator {
    return this.page.getByTestId(`hidden-format-toggle-${format}`);
  }

  async toggleScrollStops(): Promise<void> {
    await this.scrollStopsSwitch.click();
  }

  async toggleShareStats(): Promise<void> {
    await this.shareStatsSwitch.click();
  }

  async saveDisplayName(displayName: string): Promise<void> {
    await this.displayNameField.fill(displayName);
    await this.saveDisplayNameButton.click();
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

  async editGoals(): Promise<void> {
    await this.editGoalsButton.click();
  }

  async fillGoal(kind: GoalKind, target: string): Promise<void> {
    await this.goalField(kind).fill(target);
  }

  async saveGoals(): Promise<void> {
    await this.saveGoalsButton.click();
  }

  async cancelGoals(): Promise<void> {
    await this.cancelGoalsButton.click();
  }

  async setFormatHidden(format: string, hidden: boolean): Promise<void> {
    await this.hiddenFormatToggle(format).setChecked(hidden);
  }

  async saveHiddenFormats(): Promise<void> {
    await this.saveHiddenFormatsButton.click();
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
}
