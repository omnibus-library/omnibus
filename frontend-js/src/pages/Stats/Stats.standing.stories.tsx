import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { aWireStatsSummary } from "../../testing/statsHandlers";
import { api, Page } from "./Stats.stories.shared";

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
    // ARIA keeps the value inside the range; the text and the figure stay honest.
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

    // 50 of 45 minutes: met, with the bar full but the figure honest.
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
