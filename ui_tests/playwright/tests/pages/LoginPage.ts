import type { Locator, Page } from "@playwright/test";
import type { Credentials } from "../data/users";
import { BasePage } from "./BasePage";

/** The sign-in form at `/login`, which a signed-out visit elsewhere lands on. */
export class LoginPage extends BasePage {
  protected readonly urlPattern = /\/login(?:\?|$)/;

  readonly usernameField: Locator;
  readonly passwordField: Locator;
  readonly logInButton: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameField = page.getByLabel("Username");
    this.passwordField = page.getByLabel("Password");
    this.logInButton = page.getByRole("button", { name: "Log in" });
  }

  protected get readyLocator(): Locator {
    return this.usernameField;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/login");
  }

  /** Fills the form and submits it; the caller waits for what follows. */
  async logIn({ username, password }: Credentials): Promise<void> {
    await this.usernameField.fill(username);
    await this.passwordField.fill(password);
    await this.logInButton.click();
  }
}
