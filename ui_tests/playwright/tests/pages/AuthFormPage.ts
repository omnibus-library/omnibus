import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/** What the sign-in and sign-up pages share: a username field. */
export abstract class AuthFormPage extends BasePage {
  readonly usernameField: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameField = page.getByLabel("Username");
  }
}
