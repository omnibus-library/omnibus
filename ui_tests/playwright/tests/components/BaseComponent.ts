import type { Locator, Page } from "@playwright/test";

/** What every component object shares: the page it renders on. */
export abstract class BaseComponent {
  constructor(readonly page: Page) {}

  /** Clicks a viewport point, not the scrim's box: the topbar's backdrop-filter shrinks a fixed scrim to the header strip. */
  async clickOutside(): Promise<void> {
    await this.page.mouse.click(40, 500);
  }

  /** `locator`'s top edge in CSS pixels, so a test can compare vertical order. */
  async topEdge(locator: Locator): Promise<number> {
    return (await locator.boundingBox())?.y ?? Number.NaN;
  }

  /** `locator`'s bottom edge in CSS pixels. */
  async bottomEdge(locator: Locator): Promise<number> {
    const box = await locator.boundingBox();
    return box ? box.y + box.height : Number.NaN;
  }
}
