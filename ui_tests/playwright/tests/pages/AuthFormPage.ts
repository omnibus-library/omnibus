import type { Locator, Page } from "@playwright/test";
import { authUrls } from "../contracts/auth";
import { BasePage } from "./BasePage";

/** What the sign-in and sign-up pages share: a username field and the signup probe. */
export abstract class AuthFormPage extends BasePage {
  readonly usernameField: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameField = page.getByLabel("Username");
  }

  /** Pins whether signup is open, which differs between a fresh CI database and a dev one. */
  async stubRegistrationOpen(open: boolean): Promise<void> {
    await this.page.route(authUrls.registration, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: open }),
      }),
    );
  }
}
