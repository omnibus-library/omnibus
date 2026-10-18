import type { Locator, Page } from "@playwright/test";
import { TopNavComponent } from "../components/TopNavComponent";
import { chartBuilderUrls } from "../contracts/chartBuilder";
import { buildChartResult, type ChartSpec } from "../data/chartBuilder";
import { BasePage } from "./BasePage";

/**
 * The chart builder at `/stats/chart`: a picker of measures, a period and a
 * split, over a plot that opens empty.
 */
export class ChartBuilderPage extends BasePage {
  protected readonly urlPattern = /\/stats\/chart$/;

  readonly topNav: TopNavComponent;

  readonly heading: Locator;
  readonly controls: Locator;
  readonly measures: Locator;
  readonly groupBySelect: Locator;
  readonly periodSelect: Locator;
  readonly splitSelect: Locator;
  readonly scalesHint: Locator;

  readonly prompt: Locator;
  readonly canvas: Locator;
  readonly legend: Locator;
  readonly emptyState: Locator;
  readonly alert: Locator;
  readonly tooltip: Locator;
  readonly zoomBar: Locator;
  readonly showAllButton: Locator;

  readonly notes: Locator;
  readonly notesSummary: Locator;
  readonly notesScales: Locator;
  readonly notesAvailability: Locator;
  readonly notesZoom: Locator;
  readonly firstCaveat: Locator;

  private readonly plot: Locator;
  private readonly bucketBands: Locator;
  private readonly bars: Locator;
  private readonly xLabels: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);

    this.heading = page.getByRole("heading", { name: "Chart builder" });
    this.controls = page.getByTestId("chart-controls");
    this.measures = page.getByTestId("chart-measures");
    this.groupBySelect = this.controls.getByLabel("Group by");
    this.periodSelect = this.controls.getByLabel("Period");
    this.splitSelect = this.controls.getByLabel("Split");
    this.scalesHint = page.getByTestId("chart-scales");

    this.prompt = page.getByTestId("chart-prompt");
    this.canvas = page.getByTestId("chart-canvas");
    this.legend = page.getByTestId("chart-legend");
    this.emptyState = page.getByTestId("chart-empty");
    this.alert = page.getByRole("alert");
    this.tooltip = page.getByTestId("chart-tooltip");
    this.zoomBar = page.getByTestId("chart-zoom");
    this.showAllButton = page.getByRole("button", { name: "Show all" });

    this.notes = page.getByTestId("chart-notes");
    this.notesSummary = this.notes.getByText("What this chart shows");
    this.notesScales = page.getByTestId("chart-notes-scales");
    this.notesAvailability = page.getByTestId("chart-notes-availability");
    this.notesZoom = page.getByTestId("chart-notes-zoom");
    this.firstCaveat = page.getByTestId("chart-caveat").first();

    this.plot = page.locator(".cb-svg");
    this.bucketBands = page.locator(".cb-hit");
    this.bars = page.locator("rect.cb-bar");
    this.xLabels = page.locator("text.cb-xlabel");
  }

  protected get readyLocator(): Locator {
    return this.controls;
  }

  /** A measure's checkbox. */
  measure(name: string): Locator {
    return this.measures.getByLabel(name);
  }

  async goto(): Promise<void> {
    await this.openAndSettle("/stats/chart");
  }

  /**
   * Answers every chart read with a result that echoes the posted spec: the
   * suite has no reading history it can rely on, so marks are never asserted
   * against the live server.
   */
  async stubChartSeries(): Promise<void> {
    await this.page.route(chartBuilderUrls.series, (route) => {
      const posted: { spec: ChartSpec } = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildChartResult(posted.spec)),
      });
    });
  }

  async tickMeasure(name: string): Promise<void> {
    await this.measure(name).check();
  }

  async untickMeasure(name: string): Promise<void> {
    await this.measure(name).uncheck();
  }

  async groupBy(bucket: string): Promise<void> {
    await this.groupBySelect.selectOption(bucket);
  }

  async splitBy(breakdown: string): Promise<void> {
    await this.splitSelect.selectOption(breakdown);
  }

  /** Plots a count against an average, which takes both scales. */
  async plotCountAgainstAverage(): Promise<void> {
    await this.tickMeasure("Books finished");
    await this.tickMeasure("Avg book length");
    await this.legend.waitFor({ state: "attached" });
  }

  async openNotes(): Promise<void> {
    await this.notesSummary.click();
  }

  async showAll(): Promise<void> {
    await this.showAllButton.click();
  }

  async hoverBucket(index: number): Promise<void> {
    await this.bucketBands.nth(index).hover({ force: true });
  }

  /** Drags across the plot from bucket `from` to bucket `to`. */
  async brush(from: number, to: number): Promise<void> {
    // The plot sits below the picker, so a drag aimed at a band's centre
    // would land off-screen without this.
    await this.plot.scrollIntoViewIfNeeded();
    const start = await this.bucketBands.nth(from).boundingBox();
    const end = await this.bucketBands.nth(to).boundingBox();
    if (!start || !end) throw new Error("no band geometry to brush across");
    await this.page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await this.page.mouse.down();
    await this.page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
      steps: 10,
    });
    await this.page.mouse.up();
  }

  async bucketCount(): Promise<number> {
    return this.bucketBands.count();
  }

  /** The canvas settles on a chart or the empty state, never both. */
  async drawnState(): Promise<"empty" | "chart" | "pending"> {
    if ((await this.emptyState.count()) > 0) return "empty";
    if ((await this.legend.count()) > 0) return "chart";
    return "pending";
  }

  /** Each bar's `x`; stacked bars share one lane per bucket. */
  async barPositions(): Promise<(string | null)[]> {
    return this.bars.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("x")),
    );
  }

  async xLabelCount(): Promise<number> {
    return this.xLabels.count();
  }
}
