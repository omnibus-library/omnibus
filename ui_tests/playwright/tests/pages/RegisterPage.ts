import type { Locator, Page } from "@playwright/test";
import { authUrls } from "../contracts/auth";
import type { Credentials } from "../data/users";
import { AuthFormPage } from "./AuthFormPage";

/** The sign-up form at `/register`, or the notice that stands in for it when signup is closed. */
export class RegisterPage extends AuthFormPage {
  protected readonly urlPattern = /\/register(?:\?|$)/;

  readonly heading: Locator;
  readonly passwordField: Locator;
  readonly strengthMeter: Locator;
  readonly passwordHint: Locator;
  readonly createAccountButton: Locator;
  readonly fixToContinueButton: Locator;
  readonly logInLink: Locator;
  readonly form: Locator;
  readonly passwordFieldError: Locator;
  readonly closedNotice: Locator;
  readonly closedMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole("heading", {
      level: 2,
      name: /Make yourself at home/i,
    });
    // `exact` keeps the strength meter's "Password strength" label out of it.
    this.passwordField = page.getByLabel("Password", { exact: true });
    this.strengthMeter = page.getByRole("meter");
    this.passwordHint = page.getByText("At least 10 characters");
    this.createAccountButton = page.getByRole("button", {
      name: "Create account",
    });
    this.fixToContinueButton = page.getByRole("button", {
      name: /fix to continue/i,
    });
    this.logInLink = page.getByRole("link", { name: "Log in" });
    this.form = page.getByTestId("register-form");
    this.passwordFieldError = page
      .getByTestId("register-password-field")
      .getByRole("alert");
    this.closedNotice = page.getByTestId("register-closed");
    this.closedMessage = page.getByText("Registration is closed");
  }

  // The heading is in every state; the form is absent while signup is closed.
  protected get readyLocator(): Locator {
    return this.heading;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/register");
  }

  /** Fills the form and submits it; the caller waits for what follows. */
  async register({ username, password }: Credentials): Promise<void> {
    await this.usernameField.fill(username);
    await this.passwordField.fill(password);
    await this.createAccountButton.click();
  }

  /** Answers the signup with the server's 400 for a password that is too short. */
  async stubShortPasswordRejection(): Promise<void> {
    await this.page.route(authUrls.register, (route) =>
      route.fulfill({
        status: 400,
        contentType: "text/plain",
        body: "password is too short",
      }),
    );
  }
}
