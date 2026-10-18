import type { Locator, Page } from "@playwright/test";
import { authUrls } from "../contracts/auth";
import type { SignedInSession } from "../data/account";
import type { Credentials } from "../data/users";
import { expect } from "../fixtures/test";
import { AuthFormPage } from "./AuthFormPage";

/** The sign-in form at `/login`, which a signed-out visit elsewhere lands on. */
export class LoginPage extends AuthFormPage {
  protected readonly urlPattern = /\/login(?:\?|$)/;

  readonly welcomeHeading: Locator;
  readonly passwordField: Locator;
  readonly keepSignedInCheckbox: Locator;
  readonly logInButton: Locator;
  readonly registerLink: Locator;
  readonly errorBanner: Locator;

  constructor(page: Page) {
    super(page);
    this.welcomeHeading = page.getByRole("heading", {
      level: 2,
      name: /Welcome back/i,
    });
    this.passwordField = page.getByLabel("Password");
    this.keepSignedInCheckbox = page.getByLabel(
      "Keep me signed in for 30 days",
    );
    this.logInButton = page.getByRole("button", { name: "Log in" });
    this.registerLink = page.getByRole("link", { name: "Register" });
    this.errorBanner = page.getByRole("alert");
  }

  protected get readyLocator(): Locator {
    return this.usernameField;
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/login");
  }

  /** Opens `path` with no session and waits for the form the server redirects to. */
  async visitSignedOut(path: string): Promise<void> {
    await this.openAndSettle(path);
  }

  async fillCredentials({ username, password }: Credentials): Promise<void> {
    await this.usernameField.fill(username);
    await this.passwordField.fill(password);
  }

  async submit(): Promise<void> {
    await this.logInButton.click();
  }

  async submitWithEnter(): Promise<void> {
    await this.passwordField.press("Enter");
  }

  /** Fills the form and submits it; the caller waits for what follows. */
  async logIn(credentials: Credentials): Promise<void> {
    await this.fillCredentials(credentials);
    await this.submit();
  }

  async tabFromUsername(): Promise<void> {
    await this.usernameField.focus();
    await this.page.keyboard.press("Tab");
  }

  /** Answers the login with `session` instead of spending the shared per-IP sign-in budget. */
  async stubSignIn({ user, cookies }: SignedInSession): Promise<void> {
    await this.page.context().addCookies(cookies);
    await this.page.route(authUrls.login, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user }),
      }),
    );
  }

  /** Checks a visit was sent here, remembering `next` as the way back. */
  async assertRedirectedHere(next?: string): Promise<void> {
    const returnTo =
      next === undefined ? "" : `\\?next=${encodeURIComponent(next)}`;
    await expect(this.page).toHaveURL(new RegExp(`/login${returnTo}$`));
    await expect(this.readyLocator).toBeVisible();
  }
}
