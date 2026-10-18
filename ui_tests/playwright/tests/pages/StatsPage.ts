import type { Locator, Page, Response } from "@playwright/test";
import { StatsDrillSheetComponent } from "../components/StatsDrillSheetComponent";
import { StatsReaderPickerComponent } from "../components/StatsReaderPickerComponent";
import { TopNavComponent } from "../components/TopNavComponent";
import { progressUrls } from "../contracts/progress";
import { statsUrls } from "../contracts/stats";
import type { StatsRange, StatsTile } from "../data/stats";
import { expect } from "../fixtures/test";
import { holdRequests, isPostTo } from "../utils/api";
import { BasePage } from "./BasePage";

/**
 * The reading-stats page at `/stats`: a hero, a User / Library scope switch,
 * the windowed band the period pills govern and the standing band they don't.
 */
export class StatsPage extends BasePage {
  protected readonly urlPattern = /\/stats$/;

  readonly topNav: TopNavComponent;
  readonly readerPicker: StatsReaderPickerComponent;
  readonly drillIn: StatsDrillSheetComponent;

  readonly hero: Locator;
  readonly heroWho: Locator;
  readonly currentStreak: Locator;
  readonly inProgress: Locator;
  readonly emptyState: Locator;
  readonly noActivityMessage: Locator;
  readonly failureMessage: Locator;
  readonly backToYourStatsLink: Locator;

  readonly goalFigure: Locator;
  readonly goalProgress: Locator;
  readonly goalYearToDate: Locator;
  readonly goalsLink: Locator;
  readonly dailyGoals: Locator;
  readonly dailyPagesFigure: Locator;
  readonly dailyPagesToday: Locator;
  readonly dailyPagesProgress: Locator;
  readonly dailyMinutesToday: Locator;
  readonly goalEditors: Locator;
  readonly shareSwitch: Locator;
  readonly shareToggle: Locator;
  readonly shareError: Locator;

  readonly scopeSwitch: Locator;
  readonly userScope: Locator;
  readonly libraryScope: Locator;
  readonly libraryScopeTab: Locator;

  readonly windowHead: Locator;
  readonly windowLabel: Locator;
  readonly periodSection: Locator;
  readonly standingSection: Locator;
  readonly outsideWindowLabel: Locator;

  readonly readingClock: Locator;
  readonly clockEmpty: Locator;
  readonly clockDial: Locator;
  readonly clockTicks: Locator;
  readonly clockPeak: Locator;
  readonly clockLine: Locator;
  readonly clockWeekdays: Locator;
  readonly weekdayLabels: Locator;
  readonly weekdayReadouts: Locator;
  readonly clockUnzoned: Locator;

  readonly heatmap: Locator;
  readonly daysRead: Locator;
  readonly heatmapLongestStreak: Locator;
  readonly heatmapCurrentStreak: Locator;
  readonly heatmapActiveCells: Locator;
  readonly genreDonut: Locator;
  readonly donutUntagged: Locator;
  readonly formatSplit: Locator;
  readonly monthlyChart: Locator;
  readonly monthlyBars: Locator;
  readonly currentMonthBar: Locator;
  readonly superlatives: Locator;
  readonly superlativesNote: Locator;

  readonly librarySize: Locator;
  readonly libraryFigures: Locator;
  readonly libraryComposition: Locator;
  readonly compositionFormats: Locator;
  readonly compositionDecades: Locator;
  readonly compositionGenres: Locator;
  readonly compositionPublishers: Locator;
  readonly compositionPublisherBars: Locator;
  readonly compositionGhosted: Locator;

  constructor(page: Page) {
    super(page);
    this.topNav = new TopNavComponent(page);
    this.readerPicker = new StatsReaderPickerComponent(page);
    this.drillIn = new StatsDrillSheetComponent(page);

    this.hero = page.getByTestId("stats-hero");
    this.heroWho = page.getByTestId("stats-hero-who");
    this.currentStreak = page.getByTestId("stats-current-streak");
    this.inProgress = page.getByTestId("stats-in-progress");
    this.emptyState = page.getByTestId("stats-empty");
    this.noActivityMessage = page.getByText("No reading activity yet");
    // The page body only: the nav's menus raise alerts of their own.
    this.failureMessage = page.getByRole("main").getByRole("alert");
    this.backToYourStatsLink = page.getByRole("link", {
      name: "Back to your stats",
    });

    this.goalFigure = page.getByTestId("stats-goal-figure");
    this.goalProgress = page.getByTestId("stats-goal-progress");
    this.goalYearToDate = page.getByTestId("stats-goal-year-to-date");
    this.goalsLink = page.getByTestId("stats-goals-link");
    this.dailyGoals = page.getByTestId("stats-daily-goals");
    this.dailyPagesFigure = page.getByTestId("stats-daily-pages-figure");
    this.dailyPagesToday = page.getByTestId("stats-daily-pages-today");
    this.dailyPagesProgress = page.getByTestId("stats-daily-pages-progress");
    this.dailyMinutesToday = page.getByTestId("stats-daily-minutes-today");
    // Goals are edited in Settings, so none of these in-place controls exist.
    this.goalEditors = page
      .getByTestId("stats-goals-edit")
      .or(page.getByTestId("stats-goals-editor"))
      .or(page.getByTestId("stats-goal-set-link"))
      .or(page.getByTestId("stats-daily-set-link"));
    this.shareSwitch = page.getByRole("switch", {
      name: "Visible to your household",
    });
    this.shareToggle = page.getByTestId("stats-share-toggle");
    this.shareError = page.getByTestId("stats-share-error");

    this.scopeSwitch = page.getByTestId("stats-scope-switch");
    this.userScope = page.getByTestId("stats-scope-user");
    this.libraryScope = page.getByTestId("stats-scope-library");
    this.libraryScopeTab = page.getByTestId("stats-scope-tab-library");

    this.windowHead = page.getByTestId("stats-window-head");
    this.windowLabel = page.getByTestId("stats-window-label");
    this.periodSection = page.getByTestId("stats-period-section");
    this.standingSection = page.getByTestId("stats-alltime-section");
    this.outsideWindowLabel = page.getByText("Outside the window");

    this.readingClock = page.getByTestId("stats-when");
    this.clockEmpty = page.getByTestId("stats-when-empty");
    this.clockDial = page.getByTestId("stats-clock-dial");
    this.clockTicks = this.clockDial.locator(".st-clock-tick");
    this.clockPeak = page.getByTestId("stats-clock-peak");
    this.clockLine = page.getByTestId("stats-clock-line");
    this.clockWeekdays = page.getByTestId("stats-when-weekdays");
    this.weekdayLabels = this.clockWeekdays.locator(".st-day-label");
    this.weekdayReadouts = this.clockWeekdays.locator(".st-day-readout");
    this.clockUnzoned = page.getByTestId("stats-when-unzoned");

    this.heatmap = page.getByTestId("stats-heatmap");
    this.daysRead = page.getByTestId("stats-days-read");
    this.heatmapLongestStreak = this.heatmap.getByTestId(
      "stats-longest-streak",
    );
    this.heatmapCurrentStreak = this.heatmap.getByTestId(
      "stats-current-streak",
    );
    // Only active cells carry the "… on YYYY-MM-DD" tooltip.
    this.heatmapActiveCells = this.heatmap.locator('[title*=" on "]');
    this.genreDonut = page.getByTestId("stats-genre-donut");
    this.donutUntagged = page.getByTestId("stats-donut-untagged");
    this.formatSplit = this.genreDonut.getByTestId("stats-format-split");
    this.monthlyChart = page.getByTestId("stats-monthly-chart");
    this.monthlyBars = this.monthlyChart.getByTestId("stats-monthly-bar");
    this.currentMonthBar = this.monthlyBars.last();
    this.superlatives = page.getByTestId("stats-superlatives");
    this.superlativesNote = page.getByTestId("stats-superlatives-note");

    this.librarySize = page.getByTestId("stats-library-size");
    this.libraryFigures = this.librarySize.getByTestId("stats-library-figure");
    this.libraryComposition = page.getByTestId("stats-library-composition");
    this.compositionFormats = this.libraryComposition.getByTestId(
      "stats-composition-formats",
    );
    this.compositionDecades = this.libraryComposition.getByTestId(
      "stats-composition-decades",
    );
    this.compositionGenres = this.libraryComposition.getByTestId(
      "stats-composition-genres",
    );
    this.compositionPublishers = page.getByTestId(
      "stats-composition-publishers",
    );
    this.compositionPublisherBars = this.compositionPublishers.getByTestId(
      "stats-composition-bar",
    );
    this.compositionGhosted = page.getByTestId("stats-composition-ghosted");
  }

  /** The hero, or the refusal that replaces the whole page. */
  protected get readyLocator(): Locator {
    return this.hero.or(this.failureMessage);
  }

  /** A period pill; the windowed band's header holds all four. */
  periodPill(range: StatsRange): Locator {
    return this.page.getByTestId(`stats-range-${range}`);
  }

  tile(tile: StatsTile): Locator {
    return this.page.getByTestId(`stats-tile-${tile}`);
  }

  tileDelta(tile: StatsTile): Locator {
    return this.page.getByTestId(`stats-tile-${tile}-delta`);
  }

  /** Opens your own page, or another reader's when `reader` is given. */
  async goto(reader?: number): Promise<void> {
    await this.openAndSettle(
      reader === undefined ? "/stats" : `/stats?user=${reader}`,
    );
  }

  /** Opens your own page while a held fetch keeps the network from idling. */
  async gotoUnsettled(): Promise<void> {
    await this.open("/stats");
  }

  /** Waits for the fetches a click-through navigation started. */
  async waitForSettled(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
  }

  async selectPeriod(range: StatsRange): Promise<void> {
    await this.periodPill(range).click();
  }

  async openDrillIn(tile: StatsTile): Promise<void> {
    await this.tile(tile).click();
  }

  async openLibraryScope(): Promise<void> {
    await this.libraryScopeTab.click();
    await this.libraryScope.waitFor();
  }

  /** Follows the hero's one link, whatever the goals, to Settings › Goals. */
  async openGoals(): Promise<void> {
    await this.goalsLink.click();
  }

  async toggleShare(): Promise<void> {
    await this.shareSwitch.click();
  }

  async backToYourStats(): Promise<void> {
    await this.backToYourStatsLink.click();
  }

  /** Answers every summary fetch with `summary`. */
  async stubSummary(summary: Record<string, unknown>): Promise<void> {
    await this.fulfilWith(statsUrls.summary, summary);
  }

  async stubLibrarySize(size: Record<string, unknown>): Promise<void> {
    await this.fulfilWith(statsUrls.librarySize, size);
  }

  async stubLibraryComposition(
    composition: Record<string, unknown>,
  ): Promise<void> {
    await this.fulfilWith(statsUrls.libraryComposition, composition);
  }

  /** Arms a wait for the composition fetch; call it before `goto`. */
  waitForLibraryComposition(): Promise<Response> {
    return this.page.waitForResponse(isPostTo(statsUrls.libraryComposition));
  }

  /**
   * Holds the page's own in-progress fetch; the user menu's one-card call goes
   * through, so the nav still settles. The release waits for the answer to land.
   */
  async holdOwnInProgress(): Promise<() => Promise<void>> {
    const release = await holdRequests(
      this.page,
      progressUrls.recent,
      (request) => {
        const { limit, user_id }: { limit: number; user_id: number | null } =
          request.postDataJSON();
        return user_id === null && limit > 1;
      },
    );
    return async () => {
      const landed = this.page.waitForResponse(
        (response) =>
          isPostTo(progressUrls.recent)(response) &&
          response.request().postDataJSON().user_id === null,
      );
      release();
      await landed;
    };
  }

  /** Checks the URL names `reader`'s page and the page has settled on it. */
  async assertDisplayedFor(reader: number): Promise<void> {
    await this.assertDisplayedAt(new RegExp(`/stats\\?user=${reader}$`));
  }

  async assertPeriodSelected(range: StatsRange): Promise<void> {
    await expect(this.periodPill(range)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }

  private async fulfilWith(
    url: RegExp,
    body: Record<string, unknown>,
  ): Promise<void> {
    await this.page.route(url, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      }),
    );
  }
}
