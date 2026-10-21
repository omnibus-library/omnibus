import type { Page } from "@playwright/test";

/** What every component object shares: the page it renders on. */
export abstract class BaseComponent {
  constructor(readonly page: Page) {}

  /** Clicks a viewport point, not the scrim's box: the topbar's backdrop-filter shrinks a fixed scrim to the header strip. */
  async clickPageBackground(): Promise<void> {
    await this.page.mouse.click(40, 500);
  }
}
