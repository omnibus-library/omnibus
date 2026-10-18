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
  readonly dotButtons: Locator;
  readonly modeToggle: Locator;
  readonly modeToggleInRail: Locator;
  readonly modeError: Locator;
  readonly flowTopPill: Locator;
  readonly flowSections: Locator;
  readonly leadFlowSection: Locator;
  readonly leadFlowLabels: Locator;
  readonly flowLabels: Locator;
  readonly firstFlowLabel: Locator;
  readonly snapSections: Locator;
  readonly nextCues: Locator;
  readonly coverParallax: Locator;
  readonly moreStop: Locator;
  readonly seriesShelf: Locator;
  readonly seriesPageLink: Locator;

  constructor(page: Page) {
    super(page);
    this.flow = page.locator("#bdmq-flow");
    this.snap = page.locator("#bdmq-snap");
    this.dotRail = page.getByTestId("bdmq-dots");
    this.dotButtons = this.dotRail.getByRole("button");
    this.modeToggle = page.getByTestId("bdmq-mode-toggle");
    this.modeToggleInRail = this.dotRail.getByTestId("bdmq-mode-toggle");
    this.modeError = page.getByTestId("bdmq-mode-error");
    this.flowTopPill = page.getByTestId("bdmq-flowtop");
    this.flowSections = page.locator(".bdmq-flowsec");
    this.leadFlowSection = page.locator(".bdmq-flowsec.lead");
    this.leadFlowLabels = page.locator(".bdmq-flowsec.lead .bdmq-flowlab");
    this.flowLabels = page.locator(".bdmq-flowlab");
    this.firstFlowLabel = this.flowLabels.first();
    this.snapSections = page.locator(".bdmq-sec");
    this.nextCues = page.locator(".bdmq-next");
    this.coverParallax = page.locator("#bdmq-coverpx");
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

  /** The next-screen cue under a snapped screen. */
  nextCue(index: number): Locator {
    return this.section(index).locator(".bdmq-next");
  }

  async jumpTo(index: number): Promise<void> {
    await this.dot(index).click();
  }

  /** Scrolls the continuous flow `pixels` down from its top. */
  async scrollFlowTo(pixels: number): Promise<void> {
    await this.flow.evaluate((element, top) => {
      element.scrollTop = top;
    }, pixels);
  }

  /** Scrolls the flow to the top of stop `index`, as a reader reading down would arrive. */
  async scrollFlowToStop(index: number): Promise<void> {
    await this.flow.evaluate((element, stop) => {
      const section = element.querySelector<HTMLElement>(
        `[data-testid="bdmq-sec-${stop}"]`,
      )!;
      element.scrollTop = section.offsetTop;
    }, index);
  }

  /** Scrolls the flow until `target` is level with the middle of the dot rail. */
  async levelWithDotRail(target: Locator): Promise<void> {
    const middle = async (locator: Locator) => {
      const box = (await locator.boundingBox())!;
      return box.y + box.height / 2;
    };
    const distance = (await middle(target)) - (await middle(this.dotRail));
    await this.flow.evaluate((element, by) => {
      element.scrollTop += by;
    }, distance);
  }

  /** Flips the reading in place with the stage's own switch. */
  async flipMode(): Promise<void> {
    await this.modeToggle.click();
  }

  /** Scrolls the snap container to the top of stop `index`. */
  async scrollSnapToStop(index: number): Promise<void> {
    await this.snap.evaluate((element, stop) => {
      element.scrollTop = stop * element.clientHeight;
    }, index);
  }

  async flowScrollTop(): Promise<number> {
    return this.flow.evaluate((element) => element.scrollTop);
  }

  /** The cover's inline transform, which drifts with the flow's scroll. */
  async coverTransform(): Promise<string> {
    return this.coverParallax.evaluate((element) => element.style.transform);
  }

  async returnToBook(): Promise<void> {
    await this.flowTopPill.click();
  }
}
