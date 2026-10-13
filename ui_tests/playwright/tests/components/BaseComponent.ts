import type { Page } from "@playwright/test";

/** What every component object shares: the page it renders on. */
export abstract class BaseComponent {
  constructor(readonly page: Page) {}
}
