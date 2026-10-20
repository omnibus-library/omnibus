import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { storyClient } from "../../testing/AppHarness";
import { hanging } from "../../testing/handlers";
import { aWireStatsSummary } from "../../testing/statsHandlers";
import { aWireResumePoint } from "../../testing/wire";
import { api, calls, Page } from "./Stats.stories.shared";

// What sits outside the period window: the hero's goals, then the standing band.

const NO_DAILY = {
  pages: null,
  minutes: null,
  pages_today: null,
  minutes_today: null,
};

/** Every period answers with the same standing figures, `over` laid on the fixture. */
function standing(over: Partial<ReturnType<typeof aWireStatsSummary>>) {
  return api({
    stats: ({ range }) => aWireStatsSummary({ range, ...over }),
  });
}

const meta = {
  title: "Pages/Stats/Standing",
  component: Page,
  parameters: { path: "/stats" },
  beforeEach({ msw }) {
    msw.use(...api());
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnnualGoalAheadOfPace: Story = {
  play: async ({ canvas }) => {
    const ring = await canvas.findByRole("progressbar", {
      name: "Books finished in 2026",
    });
    await expect(ring).toHaveAttribute("aria-valuemin", "0");
    await expect(ring).toHaveAttribute("aria-valuemax", "24");
    await expect(ring).toHaveAttribute("aria-valuenow", "18");
    await expect(ring).toHaveAttribute("aria-valuetext", "18 of 24 books");
    await expect(ring.style.getPropertyValue("--st-ring-pct")).toBe("75%");
    await expect(ring).toHaveTextContent("18/24");
    await expect(ring).toHaveTextContent("2026 goal");
    await expect(canvas.getByText("This year")).toBeInTheDocument();
    await expect(canvas.getByTestId("stats-goal-figure")).toHaveTextContent(
      "18 of 24 books",
    );
    await expect(canvas.getByTestId("stats-goal-note")).toHaveTextContent(
      "6 books to go · 3 ahead of pace",
    );
  },
};

export const AnnualGoalPastItsTarget: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...standing({
        goal: { kind: "books", target: 24, current: 30, year: 2026 },
      }),
    );
  },
  play: async ({ canvas }) => {
    const ring = await canvas.findByRole("progressbar", {
      name: "Books finished in 2026",
    });
    // ARIA keeps the value inside the range; the text and the figure show the real one.
    await expect(ring).toHaveAttribute("aria-valuenow", "24");
    await expect(ring).toHaveAttribute("aria-valuetext", "30 of 24 books");
    await expect(ring.style.getPropertyValue("--st-ring-pct")).toBe("100%");
    await expect(ring).toHaveTextContent("30/24");
    await expect(canvas.getByTestId("stats-goal-note")).toHaveTextContent(
      /^Goal met$/,
    );
  },
};

export const AnnualGoalWithoutAServerDayHasNoPace: Story = {
  beforeEach({ msw }) {
    msw.use(...standing({ as_of_day: "" }));
  },
  play: async ({ canvas }) => {
    await canvas.findByRole("progressbar", { name: "Books finished in 2026" });
    await expect(canvas.getByTestId("stats-goal-note")).toHaveTextContent(
      /^6 books to go$/,
    );
  },
};

export const AnnualWithoutAGoalReportsTheYearSoFar: Story = {
  beforeEach({ msw }) {
    msw.use(...standing({ goal: null, books_this_year: 22 }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("2026 so far")).toBeInTheDocument();
    await expect(
      canvas.getByTestId("stats-goal-year-to-date"),
    ).toHaveTextContent("22 books");
    await expect(
      canvas.queryByRole("progressbar", { name: "Books finished in 2026" }),
    ).toBeNull();
    await expect(canvas.queryByText("This year")).toBeNull();
  },
};

export const AnnualWithoutAGoalSingularizesOneBook: Story = {
  beforeEach({ msw }) {
    msw.use(...standing({ goal: null, books_this_year: 1 }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("stats-goal-year-to-date"),
    ).toHaveTextContent("1 book");
    await expect(
      canvas.getByTestId("stats-goal-year-to-date"),
    ).not.toHaveTextContent("books");
  },
};

export const AnnualWithNoFigureInvitesATarget: Story = {
  beforeEach({ msw }) {
    msw.use(...standing({ goal: null, books_this_year: null }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No target for the year yet."),
    ).toBeInTheDocument();
  },
};

export const DailyGoalsBothSet: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Every day")).toBeInTheDocument();
    const pages = await canvas.findByRole("progressbar", {
      name: "Pages a day on 2026-08-14",
    });
    await expect(pages).toHaveAttribute("aria-valuenow", "12");
    await expect(pages).toHaveAttribute("aria-valuetext", "12 of 30 pages");
    await expect(
      canvas.getByTestId("stats-daily-pages-figure"),
    ).toHaveTextContent("12 of 30 pages");
    await expect(
      canvas.getByTestId("stats-daily-pages-note"),
    ).toHaveTextContent("18 pages to go");
    await expect(canvas.getByTestId("stats-daily-pages-note")).not.toHaveClass(
      "met",
    );
    await expect(pages.firstElementChild).toHaveAttribute(
      "style",
      "width: 40%;",
    );

    // 50 of 45 minutes is met, with the bar full and the figure still showing the real total.
    const minutes = canvas.getByRole("progressbar", {
      name: "Minutes a day on 2026-08-14",
    });
    await expect(minutes).toHaveAttribute("aria-valuenow", "45");
    await expect(minutes).toHaveAttribute("aria-valuetext", "50 of 45 minutes");
    await expect(canvas.getByTestId("stats-daily-minutes-note")).toHaveClass(
      "met",
    );
    await expect(
      canvas.getByTestId("stats-daily-minutes-note"),
    ).toHaveTextContent("Goal met");
    await expect(minutes.firstElementChild).toHaveClass("met");
    await expect(minutes.firstElementChild).toHaveAttribute(
      "style",
      "width: 100%;",
    );
  },
};

export const DailyGoalsNeitherSetReportTodayBare: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...standing({
        daily_goals: { ...NO_DAILY, pages_today: 47, minutes_today: 0 },
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Today")).toBeInTheDocument();
    await expect(canvas.queryByText("Every day")).toBeNull();
    // A zero is an answer, not an absence.
    await expect(
      canvas.getByTestId("stats-daily-pages-today"),
    ).toHaveTextContent(/^47$/);
    await expect(
      canvas.getByTestId("stats-daily-minutes-today"),
    ).toHaveTextContent(/^0$/);
    await expect(canvas.getByText("Pages")).toBeInTheDocument();
    await expect(canvas.getByText("Minutes")).toBeInTheDocument();
    await expect(canvas.queryByText("Pages a day")).toBeNull();
    // No bar without a target.
    await expect(
      canvas.queryByRole("progressbar", { name: /a day/ }),
    ).toBeNull();
  },
};

export const DailyGoalsNeitherSetWithNoFigureInvite: Story = {
  beforeEach({ msw }) {
    msw.use(...standing({ daily_goals: NO_DAILY }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("stats-daily-pages-invite"),
    ).toHaveTextContent("No target set.");
    await expect(
      canvas.getByTestId("stats-daily-minutes-invite"),
    ).toHaveTextContent("No target set.");
  },
};

export const DailyGoalsOneSetCarryTheirOwnTimeframe: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...standing({
        daily_goals: {
          ...NO_DAILY,
          pages: { kind: "pages", target: 30, current: 18, day: "2026-08-14" },
          pages_today: 18,
          minutes_today: 75,
        },
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Every day")).toBeInTheDocument();
    await expect(canvas.getByText("Pages a day")).toBeInTheDocument();
    await expect(canvas.getByText("Minutes today")).toBeInTheDocument();
    await expect(
      canvas.getByTestId("stats-daily-minutes-today"),
    ).toHaveTextContent(/^75$/);
  },
};

export const GoalsLinkInvitesWhenNoneIsSet: Story = {
  beforeEach({ msw }) {
    msw.use(...standing({ goal: null, daily_goals: NO_DAILY }));
  },
  play: async ({ canvas, userEvent }) => {
    const link = await canvas.findByRole("link", { name: "Set goals" });
    await expect(link).toHaveAttribute("href", "/settings?section=goals");
    await userEvent.click(link);
    await expect(
      await canvas.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
  },
};

export const GoalsLinkEditsOnceAnyIsSet: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("link", { name: "Edit goals" }),
    ).toHaveAttribute("href", "/settings?section=goals");
    await expect(canvas.queryByRole("link", { name: "Set goals" })).toBeNull();
  },
};

export const GoalsLinkIsAbsentOnAnotherReadersPage: Story = {
  parameters: { path: "/stats?user=2" },
  play: async ({ canvas }) => {
    await canvas.findByText("Grace's stats");
    await expect(canvas.queryByRole("link", { name: /goals/ })).toBeNull();
    // Their goals are still reported.
    await expect(canvas.getByTestId("stats-goal")).toBeInTheDocument();
  },
};

const FINISHED = aWireStatsSummary().finished_books?.[0];

export const HeatmapDrawsATrailingYearMondayFirst: Story = {
  play: async ({ canvas }) => {
    const grid = await canvas.findByRole("img", {
      name: "Daily reading activity, trailing year",
    });
    await expect(grid.children).toHaveLength(364);
    // 2026-08-14 is a Friday, so the Saturday and Sunday after it are spacers.
    await expect(grid.querySelectorAll(".st-hm-future")).toHaveLength(2);
    // The twelve-day run is outlined; the busiest day is the darkest.
    await expect(grid.querySelectorAll(".run")).toHaveLength(12);
    await expect(
      grid.querySelector('[title="1 h 25 m on 2026-08-14"]'),
    ).toHaveClass("st-hm-4", "run");
    await expect(grid.querySelector('[title="2026-08-01"]')).toHaveClass(
      "st-hm-0",
    );
    await expect(grid.querySelector('[title="2026-08-15"]')).toHaveClass(
      "st-hm-future",
    );
  },
};

export const HeatmapReportsItsCoverageAndTheRecord: Story = {
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("stats-heatmap");
    await expect(within(card).getByTestId("stats-days-read")).toHaveTextContent(
      "12days read",
    );
    // 12 of the 362 days from the grid's first Monday to today.
    await expect(
      within(card).getByText("of the year").parentElement,
    ).toHaveTextContent("3%of the year");
    await expect(
      within(card).getByTestId("stats-longest-streak"),
    ).toHaveTextContent("20 daysbest run");
    await expect(card.querySelector(".st-hm-months")).toHaveTextContent(
      "SepOctNovDecJanFebMarAprMayJunJulAug",
    );
    await expect(card.querySelector(".st-hm-legend")).toHaveTextContent(
      "lessmore",
    );
    await expect(
      card.querySelectorAll(".st-hm-legend .st-hm-cell"),
    ).toHaveLength(5);
  },
};

export const HeatmapRecordSingularizesOneDayButNotItsLabel: Story = {
  beforeEach({ msw }) {
    msw.use(...standing({ longest_streak_days: 1 }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("stats-longest-streak"),
    ).toHaveTextContent("1 daybest run");
  },
};

export const HeatmapHoldsItsSpaceWithoutADayToAnchorOn: Story = {
  beforeEach({ msw }) {
    msw.use(...standing({ as_of_day: "", heatmap: [] }));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("stats-alltime-section");
    await expect(canvas.queryByTestId("stats-heatmap")).toBeNull();
    await expect(
      document.querySelector(".st-card-placeholder[aria-hidden='true']"),
    ).not.toBeNull();
  },
};

export const OpenBooksAskForOneMoreThanTheyList: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Nothing open right now."),
    ).toBeInTheDocument();
    await expect(calls.recent.map((p) => p.get("limit"))).toEqual(["4"]);
    await expect(calls.recent[0]?.has("user_id")).toBe(false);
  },
};

export const OpenBooksFollowTheReaderBeingViewed: Story = {
  parameters: { path: "/stats?user=2" },
  play: async ({ canvas }) => {
    await canvas.findByText("Grace's stats");
    await expect(calls.recent.map((p) => p.get("user_id"))).toEqual(["2"]);
  },
};

export const OpenBooksAreAskedAgainOnReturningToAReader: Story = {
  parameters: { path: "/stats?user=2" },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("Grace's stats");
    await userEvent.click(
      canvas.getByRole("button", { name: "Stats for Grace" }),
    );
    await userEvent.click(canvas.getByTestId("stats-reader-option-you"));
    await canvas.findByRole("heading", { level: 1, name: "12 days." });

    await userEvent.click(
      canvas.getByRole("button", { name: "Stats for You" }),
    );
    await userEvent.click(canvas.getByTestId("stats-reader-option-2"));

    await canvas.findByText("Grace's stats");
    await expect(calls.recent.map((p) => p.get("user_id"))).toEqual([
      "2",
      null,
      "2",
    ]);
  },
};

const withReadout = (
  n: number,
  record: Parameters<typeof aWireResumePoint>[0],
  extra: { audio_part?: number; audio_part_count?: number } = {},
) => ({
  ...aWireResumePoint(
    { book_uuid: `00000000-0000-4000-8000-00000000000${n}`, ...record },
    {
      title: `Open Book ${n}`,
      unique_identifier: `00000000-0000-4000-8000-00000000000${n}`,
      creators: [{ name: `Author ${n}`, role: null, file_as: null, id: n }],
    },
  ),
  ...extra,
});

export const OpenBooksListThreeRowsWithTheirReadouts: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        recent: [
          withReadout(1, { progress_percent: 62 }),
          withReadout(2, {
            progress_percent: null,
            resolved: {
              confidence: "high",
              chapter_ordinal: 3,
              chapters_total: 12,
            },
          }),
          withReadout(
            3,
            { progress_percent: null },
            { audio_part: 2, audio_part_count: 5 },
          ),
          withReadout(4, { progress_percent: 10 }),
        ],
      }),
    );
  },
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("stats-in-progress");
    const rows = within(card).getAllByRole("link");
    await expect(rows).toHaveLength(3);
    await expect(rows[0]).toHaveAttribute(
      "href",
      "/books/00000000-0000-4000-8000-000000000001",
    );
    await expect(rows[0]).toHaveTextContent("Open Book 1Author 162%");
    await expect(rows[0]?.querySelector(".st-open-fill")).toHaveAttribute(
      "style",
      "width: 62%;",
    );
    await expect(rows[1]).toHaveTextContent("Open Book 2Author 2Ch 3 of 12");
    await expect(rows[2]).toHaveTextContent("Open Book 3Author 3Pt 2 of 5");
    await expect(rows[2]?.querySelector(".st-open-fill")).toHaveAttribute(
      "style",
      "width: 0%;",
    );
    // Four came back and three are listed, so the card says the list is cut.
    await expect(
      within(card).getByTestId("stats-in-progress-more"),
    ).toHaveTextContent("Showing the 3 most recently opened.");
    await expect(within(card).queryByText("Open Book 4")).toBeNull();
    await expect(
      within(rows[0] as HTMLElement).getByRole("img", {
        name: "Cover of Open Book 1",
      }),
    ).toBeInTheDocument();
  },
};

export const OpenBookWithNoReadoutSaysNothing: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ recent: [withReadout(1, { progress_percent: null })] }));
  },
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("stats-in-progress");
    await expect(within(card).getByRole("link")).toHaveTextContent(
      /^Open Book 1Author 1$/,
    );
    await expect(
      within(card).queryByTestId("stats-in-progress-more"),
    ).toBeNull();
  },
};

export const OpenBooksHoldThePageUntilTheyAnswer: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/progress/recent"));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(
        storyClient().getQueryState(["stats", null, "all_time"])?.status,
      ).toBe("success"),
    );
    await expect(canvas.getByText("Tallying your reading")).toBeInTheDocument();
    await expect(canvas.queryByText("Nothing open right now.")).toBeNull();
    await expect(canvas.queryByTestId("stats-hero")).toBeNull();
  },
};

export const FailedOpenBooksReadSettlesAsNoneOpen: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ recent: 500 }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Nothing open right now."),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("stats-hero")).toBeInTheDocument();
  },
};

export const YearProjectionStatesTheYearsPace: Story = {
  play: async ({ canvas }) => {
    // 12 books by day 226 of 365.
    await expect(
      await canvas.findByTestId("stats-year-projection"),
    ).toHaveTextContent("At this pace you finish the year on19 books");
  },
};

export const YearProjectionStaysQuietEarlyInTheYear: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...standing({
        as_of_day: "2026-01-05",
        books_per_month: [{ month: "2026-01", books: 1 }],
      }),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("stats-in-progress");
    await expect(canvas.queryByTestId("stats-year-projection")).toBeNull();
  },
};

export const RecentlyFinishedLinksEachBookWithItsStars: Story = {
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("stats-recently-finished");
    const link = within(card).getByRole("link");
    await expect(link).toHaveAttribute(
      "href",
      "/books/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    );
    await expect(link).toHaveTextContent("Aurora Station, Vol. 1Sora Inkwell");
    await expect(
      within(link).getByRole("img", { name: "4.5 out of 5 stars" }),
    ).toHaveClass("st-finished-stars");
    await expect(
      within(link).getByRole("img", {
        name: "Cover of Aurora Station, Vol. 1",
      }),
    ).toBeInTheDocument();
  },
};

export const RecentlyFinishedDrawsADashForAnUnratedBook: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...standing({
        finished_books: FINISHED ? [{ ...FINISHED, rating: null }] : [],
      }),
    );
  },
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("stats-recently-finished");
    await expect(card.querySelector(".st-finished-unrated")).toHaveTextContent(
      "—",
    );
    await expect(
      within(card).queryByRole("img", { name: /out of 5 stars/ }),
    ).toBeNull();
  },
};

export const RecentlyFinishedListsFourAtMost: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...standing({
        finished_books: Array.from({ length: 5 }, (_, i) => ({
          book_uuid: `00000000-0000-4000-8000-00000000010${i}`,
          title: `Finished ${i}`,
          finished_at: 1_786_000_000 - i,
        })),
      }),
    );
  },
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("stats-recently-finished");
    await expect(within(card).getAllByRole("link")).toHaveLength(4);
    await expect(within(card).queryByText("Finished 4")).toBeNull();
  },
};

export const RecentlyFinishedSaysSoWhenNothingIs: Story = {
  beforeEach({ msw }) {
    msw.use(...standing({ finished_books: [] }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Nothing finished yet."),
    ).toBeInTheDocument();
  },
};

export const MonthlyChartDrawsTwelveColumns: Story = {
  play: async ({ canvas }) => {
    const chart = await canvas.findByTestId("stats-monthly-chart");
    await expect(chart).toHaveTextContent(
      "Books finished · trailing 12 months",
    );
    await expect(chart).toHaveTextContent("avg 1.5 / month");
    const bars = within(chart).getAllByTestId("stats-monthly-bar");
    await expect(bars).toHaveLength(12);
    await expect(
      bars
        .map((bar) => bar.querySelector(".st-mo-label")?.textContent)
        .join(""),
    ).toBe("SONDJFMAMJJA");
    await expect(
      bars.map((bar) => bar.querySelector(".st-mo-count")?.textContent),
    ).toEqual(["0", "1", "2", "3", "0", "1", "2", "3", "0", "1", "2", "3"]);
    await expect(bars[2]?.querySelector(".st-mo-bar")).toHaveAttribute(
      "style",
      "height: 66%;",
    );
    // The last month is the current one even though it ties the peak; the other peaks are called out.
    await expect(bars[11]).toHaveClass("current");
    await expect(bars[11]).not.toHaveClass("peak");
    await expect(
      bars.filter((bar) => bar.classList.contains("peak")),
    ).toHaveLength(2);
    await expect(bars[11]).toHaveAttribute("title", "3 finished");
  },
};

export const MonthlyAverageSettlesOnTheEvenDecimal: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...standing({
        books_per_month: Array.from({ length: 12 }, (_, i) => ({
          month: `2026-${String(i + 1).padStart(2, "0")}`,
          books: i < 3 ? 1 : 0,
        })),
      }),
    );
  },
  play: async ({ canvas }) => {
    // Three books over twelve months is 0.25, which Rust formats as 0.2.
    await expect(
      await canvas.findByText("avg 0.2 / month"),
    ).toBeInTheDocument();
  },
};

export const MonthlyChartHoldsItsSpaceWithoutMonths: Story = {
  beforeEach({ msw }) {
    msw.use(...standing({ books_per_month: [] }));
  },
  play: async ({ canvas }) => {
    const section = await canvas.findByTestId("stats-alltime-section");
    await expect(canvas.queryByTestId("stats-monthly-chart")).toBeNull();
    // The heatmap is drawn, so the one placeholder in the band can only be the chart's.
    await expect(
      within(section).getByTestId("stats-heatmap"),
    ).toBeInTheDocument();
    await expect(
      section.querySelectorAll(".st-card-placeholder[aria-hidden='true']"),
    ).toHaveLength(1);
  },
};
