import type { Locator, Page } from "@playwright/test";

/** What every component object shares: the page it renders on. */
export abstract class BaseComponent {
  constructor(readonly page: Page) {}

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
