import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/**
 * The book page's six stops, laid out as one continuous flow or as snapped
 * screens by the viewer's scroll-stops preference (04a); only one is in the DOM.
 */
export class BookDetailStopsComponent extends BaseComponent {
  readonly flow: Locator;
  readonly snap: Locator;
  readonly dotRail: Locator;
  readonly flowTopPill: Locator;
  readonly moreStop: Locator;
  readonly seriesShelf: Locator;
  readonly seriesPageLink: Locator;

  constructor(page: Page) {
    super(page);
    this.flow = page.locator("#bdmq-flow");
    this.snap = page.locator("#bdmq-snap");
    this.dotRail = page.getByTestId("bdmq-dots");
    this.flowTopPill = page.getByTestId("bdmq-flowtop");
    this.moreStop = page.getByTestId("bdmq-more");
    this.seriesShelf = page.getByTestId("bdmq-series-shelf");
    this.seriesPageLink = page.getByRole("link", { name: /series page/ });
  }

  /** The dot-rail button for stop `index`, counted from 0. */
  dot(index: number): Locator {
    return this.page.getByTestId(`bdmq-dot-${index}`);
  }

  /** The snapped screen for stop `index`. */
  section(index: number): Locator {
    return this.page.getByTestId(`bdmq-sec-${index}`);
  }

  sectionLabel(index: number): Locator {
    return this.section(index).locator(".bdmq-seclab");
  }

  /** The "scroll — next" cue under a snapped screen. */
  nextCue(index: number): Locator {
    return this.section(index).locator(".bdmq-next");
  }

  async jumpTo(index: number): Promise<void> {
    await this.dot(index).click();
  }
}
