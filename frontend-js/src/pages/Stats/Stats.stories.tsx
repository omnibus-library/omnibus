import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { storyClient } from "../../testing/AppHarness";
import { deferred, hanging } from "../../testing/handlers";
import { aWireStatsSummary } from "../../testing/statsHandlers";
import { api, calls, Page } from "./Stats.stories.shared";

const QUIET = aWireStatsSummary({
  reading_seconds: 0,
  listening_seconds: 0,
  books_finished: 0,
  current_streak_days: 0,
  longest_streak_days: 0,
  heatmap: [],
});

const meta = {
  title: "Pages/Stats",
  component: Page,
  parameters: { path: "/stats" },
  beforeEach({ msw }) {
    msw.use(...api());
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HoldsTheLoaderUntilStatsAnswer: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/stats"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Tallying your reading"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("stats-hero")).not.toBeInTheDocument();
  },
};

export const HoldsTheLoaderUntilReadersAnswer: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/users"));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(
        storyClient().getQueryState(["stats", null, "all_time"])?.status,
      ).toBe("success"),
    );
    await expect(canvas.getByText("Tallying your reading")).toBeInTheDocument();
    await expect(canvas.queryByTestId("stats-hero")).not.toBeInTheDocument();
  },
};

export const FailedReaderListCountsAsAnswered: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ readers: 500 }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("stats-hero")).toBeInTheDocument();
    await expect(canvas.queryByText("Tallying your reading")).toBeNull();
  },
};

export const AsksEachPeriodOnTheDeviceCalendar: Story = {
  play: async ({ canvas }) => {
    await canvas.findByTestId("stats-hero");
    await waitFor(() => expect(calls.stats).toHaveLength(2));
    await expect(calls.stats.map((p) => p.get("range")).sort()).toEqual([
      "all_time",
      "month",
    ]);
    for (const params of calls.stats) {
      await expect(params.get("utc_offset_minutes")).toBe(
        String(-new Date().getTimezoneOffset()),
      );
      await expect(params.has("user_id")).toBe(false);
    }
  },
};

export const AsksForAnotherReadersFigures: Story = {
  parameters: { path: "/stats?user=2" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Grace's stats")).toBeInTheDocument();
    await expect(calls.stats.map((p) => p.get("user_id"))).toEqual(["2", "2"]);
  },
};

export const OwnPageFailureOffersTheLibrary: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ stats: () => 500 }));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await userEvent.click(
      canvas.getByRole("link", { name: "Back to library" }),
    );
    await expect(
      await canvas.findByRole("heading", { name: "Library" }),
    ).toBeInTheDocument();
  },
};

export const RefusedReaderOffersYourOwnStats: Story = {
  parameters: { path: "/stats?user=2" },
  beforeEach({ msw }) {
    msw.use(
      ...api({
        stats: ({ range, userId }) =>
          userId === null ? aWireStatsSummary({ range }) : 404,
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "This reader isn't sharing their stats",
    );
    await userEvent.click(
      canvas.getByRole("link", { name: "Back to your stats" }),
    );
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "12 days." }),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("stats-hero-who")).toBeNull();
  },
};

export const FailureOnAnotherReaderReturnsToYourStats: Story = {
  parameters: { path: "/stats?user=2" },
  beforeEach({ msw }) {
    msw.use(...api({ stats: () => 500 }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(
      canvas.getByRole("link", { name: "Back to your stats" }),
    ).toHaveAttribute("href", "/stats");
  },
};

export const FailingPeriodFailsThePage: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        stats: ({ range }) =>
          range === "month" ? 500 : aWireStatsSummary({ range }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(canvas.queryByTestId("stats-hero")).toBeNull();
  },
};

export const HeroOnARun: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "12 days." }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("You are on a run")).toBeInTheDocument();
    await expect(canvas.getByTestId("stats-streak-line")).toHaveTextContent(
      "Your longest ever is 20 days.",
    );
    const spark = canvas.getByRole("img", {
      name: "Daily activity over the last six weeks",
    });
    await expect(spark.children).toHaveLength(42);
    await expect(spark.querySelectorAll(".st-spark-bar.on")).toHaveLength(12);
    await expect(spark.querySelectorAll(".st-spark-bar.off")).toHaveLength(30);
    await expect(canvas.getByText("6 weeks ago")).toBeInTheDocument();
    await expect(canvas.getByText("today")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Omnibus | Stats"));
  },
};

export const HeroOnASingleDayRun: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        stats: ({ range }) =>
          aWireStatsSummary({
            range,
            current_streak_days: 1,
            longest_streak_days: 1,
          }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "1 day." }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("stats-streak-line")).toHaveTextContent(
      "That is the longest run you have recorded.",
    );
  },
};

export const HeroWithNoRun: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        stats: ({ range }) =>
          aWireStatsSummary({ range, current_streak_days: 0 }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No run right now"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { level: 1, name: "0 days." }),
    ).toBeInTheDocument();
  },
};

export const HeroWithoutAServerDayDrawsNoSpark: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        stats: ({ range }) => aWireStatsSummary({ range, as_of_day: "" }),
      }),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("stats-hero");
    await expect(canvas.queryByRole("img")).toBeNull();
    await expect(canvas.queryByText("6 weeks ago")).toBeNull();
  },
};

export const HeroOnAnotherReadersPage: Story = {
  parameters: { path: "/stats?user=2" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("stats-hero-who")).toHaveTextContent(
      "Grace's stats",
    );
    await expect(canvas.getByText("On a run")).toBeInTheDocument();
    await expect(canvas.getByTestId("stats-streak-line")).toHaveTextContent(
      "The longest ever is 20 days.",
    );
  },
};

export const EmptyReaderKeepsTheHero: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ stats: ({ range }) => ({ ...QUIET, range }) }));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("stats-hero")).toBeInTheDocument();
    await expect(canvas.getByTestId("stats-empty")).toHaveTextContent(
      "No reading activity yet",
    );
    await expect(
      canvas.getByText(
        "Open a book or start an audiobook and your stats will begin to fill in.",
      ),
    ).toBeInTheDocument();
  },
};

export const EmptyAnotherReaderSaysSo: Story = {
  parameters: { path: "/stats?user=2" },
  beforeEach({ msw }) {
    msw.use(...api({ stats: ({ range }) => ({ ...QUIET, range }) }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Grace hasn't tracked any reading yet."),
    ).toBeInTheDocument();
  },
};

export const WindowBandLabelsTheCurrentPeriod: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText("In this window")).toBeInTheDocument();
    const pills = within(canvas.getByRole("group", { name: "Period" }));
    await expect(
      pills.getAllByRole("button").map((b) => b.textContent),
    ).toEqual(["Week", "Month", "Year", "Lifetime"]);
    await expect(pills.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByTestId("stats-window-label")).toHaveTextContent(
      "August 2026 · month to date",
    );

    await userEvent.click(pills.getByRole("button", { name: "Year" }));

    await waitFor(() =>
      expect(canvas.getByTestId("stats-window-label")).toHaveTextContent(
        "2026 · year to date",
      ),
    );
    await expect(pills.getByRole("button", { name: "Year" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(pills.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(calls.stats.map((p) => p.get("range"))).toContain("year");
  },
};

let held = deferred();

export const WindowPlaceholderUntilThePeriodLands: Story = {
  beforeEach({ msw }) {
    held = deferred();
    msw.use(
      ...api({
        stats: async ({ range }) => {
          if (range === "month") await held.promise;
          return aWireStatsSummary({ range });
        },
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("stats-window-loading"),
    ).toHaveTextContent("Tallying this window");
    await expect(canvas.getByTestId("stats-hero")).toBeInTheDocument();
    held.release();
    await waitFor(() =>
      expect(canvas.queryByTestId("stats-window-loading")).toBeNull(),
    );
  },
};

export const SwitchingKeepsThePreviousWindowWhileItLoads: Story = {
  beforeEach({ msw }) {
    held = deferred();
    msw.use(
      ...api({
        stats: async ({ range }) => {
          if (range === "year") await held.promise;
          return aWireStatsSummary({ range });
        },
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("stats-hero");
    await waitFor(() =>
      expect(canvas.queryByTestId("stats-window-loading")).toBeNull(),
    );

    await userEvent.click(canvas.getByRole("button", { name: "Year" }));

    await expect(canvas.getByTestId("stats-window-label")).toHaveTextContent(
      "2026 · year to date",
    );
    await expect(canvas.queryByTestId("stats-window-loading")).toBeNull();
    held.release();
  },
};

export const PeriodSwitchLeavesTheStandingFiguresAlone: Story = {
  play: async ({ canvas, userEvent }) => {
    const hero = await canvas.findByTestId("stats-hero");
    const standing = canvas.getByTestId("stats-alltime-section");
    await waitFor(() =>
      expect(canvas.queryByTestId("stats-window-loading")).toBeNull(),
    );
    const before = [hero.textContent, standing.textContent];

    await userEvent.click(canvas.getByRole("button", { name: "Year" }));
    await waitFor(() =>
      expect(calls.stats.map((p) => p.get("range"))).toContain("year"),
    );
    await waitFor(() =>
      expect(canvas.getByTestId("stats-window-label")).toHaveTextContent(
        "2026",
      ),
    );

    await expect([hero.textContent, standing.textContent]).toEqual(before);
  },
};

export const StandingBandAndFootnote: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Outside the window"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("stats-freshness-note")).toHaveTextContent(
      "Stats are accurate to the last ~60 seconds.",
    );
  },
};
