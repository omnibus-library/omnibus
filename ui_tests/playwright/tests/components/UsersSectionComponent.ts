import type { Locator, Page } from "@playwright/test";
import { usersUrls } from "../contracts/users";
import type { Credentials, NewUser } from "../data/users";
import { BaseComponent } from "./BaseComponent";

/** Settings → Users: the account table, its new-user form and the sign-up switch. */
export class UsersSectionComponent extends BaseComponent {
  readonly heading: Locator;
  readonly table: Locator;
  readonly newUserButton: Locator;
  readonly usernameField: Locator;
  readonly passwordField: Locator;
  readonly submitButton: Locator;
  readonly formError: Locator;
  readonly deleteDialog: Locator;
  readonly deleteConfirmButton: Locator;
  readonly registrationCard: Locator;
  readonly registrationSwitch: Locator;
  readonly registrationError: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", { level: 2, name: "Users" });
    this.table = page.getByTestId("users-table");
    this.newUserButton = page.getByTestId("users-new");
    this.usernameField = page.getByTestId("new-user-username");
    this.passwordField = page.getByTestId("new-user-password");
    this.submitButton = page.getByTestId("new-user-submit");
    this.formError = page.getByTestId("users-modal-error");
    this.deleteDialog = page.getByTestId("users-delete-modal");
    this.deleteConfirmButton = page.getByTestId("delete-user-confirm");
    this.registrationCard = page.getByTestId("registration-card");
    this.registrationSwitch = page.getByTestId("registration-toggle");
    this.registrationError = page.getByTestId("registration-error");
  }

  /** A permission checkbox of the new-user form. */
  permission(name: keyof NewUser["permissions"]): Locator {
    return this.page.getByTestId(`perm-${name}`);
  }

  /** A user's table row, found by username. */
  row(username: string): Locator {
    return this.table.locator("tr", { hasText: username });
  }

  /** The chip a row shows for each permission its user holds. */
  permissionChip(username: string, chip: string): Locator {
    return this.row(username).getByText(chip);
  }

  async openNewUserForm(): Promise<void> {
    await this.newUserButton.click();
  }

  async fillCredentials({ username, password }: Credentials): Promise<void> {
    await this.usernameField.fill(username);
    await this.passwordField.fill(password);
  }

  async checkPermission(name: keyof NewUser["permissions"]): Promise<void> {
    await this.permission(name).check();
  }

  async submitNewUser(): Promise<void> {
    await this.submitButton.click();
  }

  async openDeleteDialog(username: string): Promise<void> {
    await this.row(username).getByRole("button", { name: "Delete" }).click();
  }

  async confirmDelete(): Promise<void> {
    await this.deleteConfirmButton.click();
  }

  /** Clicks the scrim, well away from the centred dialog panel. */
  async clickDeleteBackdrop(): Promise<void> {
    await this.deleteDialog.click({ position: { x: 5, y: 5 } });
  }

  async allowRegistration(): Promise<void> {
    await this.registrationSwitch.check();
  }

  // `uncheck()` re-reads the state after its click, racing the forced 500's revert.
  async blockRegistration(): Promise<void> {
    await this.registrationSwitch.click();
  }

  /** Holds each delete for `ms`, so the dialog is still busy mid-request. */
  async stubSlowDeletes(ms: number): Promise<void> {
    await this.page.route(usersUrls.byId, async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      await new Promise((resolve) => setTimeout(resolve, ms));
      return route.continue();
    });
  }

  /** Answers the sign-up status read, which is one row the whole server shares. */
  async stubRegistrationOpen(open: boolean): Promise<void> {
    await this.page.route(usersUrls.registrationStatus, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: open }),
      }),
    );
  }

  /** Accepts the sign-up switch's write without storing it. */
  async stubRegistrationSaved(): Promise<void> {
    await this.page.route(usersUrls.registration, (route) =>
      route.fulfill({ status: 204, body: "" }),
    );
  }
}
