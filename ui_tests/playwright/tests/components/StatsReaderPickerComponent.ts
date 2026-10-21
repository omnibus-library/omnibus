import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The household picker in the stats hero: whose figures the page shows. */
export class StatsReaderPickerComponent extends BaseComponent {
  readonly root: Locator;
  readonly trigger: Locator;
  readonly menu: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("stats-reader-picker");
    this.trigger = page.getByTestId("stats-reader-trigger");
    this.menu = page.getByTestId("stats-reader-menu");
  }

  /** A reader's row, or `"you"` for the caller; rows stay in the DOM while the menu is closed. */
  option(who: number | "you"): Locator {
    return this.page.getByTestId(`stats-reader-option-${who}`);
  }

  optionAvatar(who: number | "you"): Locator {
    return this.option(who).locator(".st-reader-avatar");
  }

  async open(): Promise<void> {
    await this.trigger.click();
  }

  async choose(who: number | "you"): Promise<void> {
    await this.option(who).click();
  }

  /** Opens the menu and chooses `who`. */
  async pick(who: number | "you"): Promise<void> {
    await this.open();
    await this.choose(who);
  }
}
