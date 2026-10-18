import type { Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/** The modal sheet a stats tile opens over the page. */
export class StatsDrillSheetComponent extends BaseComponent {
  readonly root: Locator;
  readonly closeButton: Locator;
  readonly delta: Locator;

  readonly pagesNote: Locator;
  readonly pagesCutover: Locator;
  readonly pagesRate: Locator;

  readonly histogram: Locator;
  readonly histogramOrEmpty: Locator;
  readonly histogramCaption: Locator;
  readonly histogramBarLabels: Locator;
  readonly histogramBarValues: Locator;
  readonly histogramEmptyBars: Locator;

  readonly trend: Locator;
  readonly trendCaption: Locator;
  readonly trendBarLabels: Locator;
  readonly trendBarValues: Locator;
  readonly trendEmptyBars: Locator;

  readonly finishedList: Locator;
  readonly lengthSplit: Locator;
  readonly firstLengthRow: Locator;

  constructor(page: Page) {
    super(page);
    this.root = page.getByTestId("stats-drill-in");
    this.closeButton = page.getByTestId("stats-drill-close");
    this.delta = page.getByTestId("stats-drill-delta");

    this.pagesNote = page.getByTestId("stats-drill-pages-note");
    this.pagesCutover = page.getByTestId("stats-drill-pages-cutover");
    this.pagesRate = page.getByTestId("stats-drill-pages-rate");

    this.histogram = page.getByTestId("stats-drill-histogram");
    this.histogramOrEmpty = this.histogram.or(
      page.getByTestId("stats-drill-histogram-empty"),
    );
    this.histogramCaption = page.getByTestId("stats-drill-histogram-caption");
    this.histogramBarLabels = this.histogram.getByTestId(
      "stats-drill-bar-label",
    );
    this.histogramBarValues = this.histogram.getByTestId(
      "stats-drill-bar-value",
    );
    this.histogramEmptyBars = this.histogram.getByTestId(
      "stats-drill-bar-empty",
    );

    this.trend = page.getByTestId("stats-drill-trend");
    this.trendCaption = page.getByTestId("stats-drill-trend-caption");
    this.trendBarLabels = this.trend.getByTestId("stats-drill-bar-label");
    this.trendBarValues = this.trend.getByTestId("stats-drill-bar-value");
    this.trendEmptyBars = this.trend.getByTestId("stats-drill-bar-empty");

    this.finishedList = page.getByTestId("stats-drill-finished-list");
    this.lengthSplit = page.getByTestId("stats-length-split");
    this.firstLengthRow = this.lengthSplit
      .getByTestId("stats-length-row")
      .first();
  }

  /** The histogram bar whose hover text is `title`. */
  histogramBar(title: string): Locator {
    return this.histogram.locator(`[title="${title}"]`);
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }

  /** Clicks the scrim beside the sheet, outside the panel. */
  async closeFromBackdrop(): Promise<void> {
    await this.root.click({ position: { x: 4, y: 4 } });
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }
}
