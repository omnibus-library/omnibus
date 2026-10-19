import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { aWireStatsSummary } from "../../testing/statsHandlers";
import { api, Page } from "./Stats.stories.shared";

// What the period pills govern: the window band's cards.

type Over = Partial<ReturnType<typeof aWireStatsSummary>>;

/** The period answers with `over` laid on the fixture; Lifetime and the hero keep the plain one. */
function inWindow(over: Over) {
  return api({
    stats: ({ range }) =>
      aWireStatsSummary({ range, ...(range === "all_time" ? {} : over) }),
  });
}

const NO_STANDOUTS: Over = {
  superlatives: {},
  busiest_week_start: null,
  busiest_week_seconds: 0,
  top_authors: [],
  top_tags: [],
};

const meta = {
  title: "Pages/Stats/Window",
  component: Page,
  parameters: { path: "/stats" },
  beforeEach({ msw }) {
    msw.use(...api());
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClockDrawsTheDialAndTheWeekdays: Story = {
  play: async ({ canvas }) => {
    const dial = await canvas.findByRole("img", {
      name: "Activity by hour of day",
    });
    await expect(dial.querySelectorAll(".st-clock-tick")).toHaveLength(24);
    // 20:00 is the busiest hour: a full-reach tick at 480deg, and the hub names it.
    await expect(dial.children[20]).toHaveAttribute(
      "style",
      "transform: rotate(480deg) translateY(58px); height: 40px;",
    );
    await expect(dial.children[20]).toHaveClass("hot");
    await expect(dial.children[21]).toHaveClass("warm");
    await expect(dial.children[7]).toHaveClass("cool");
    await expect(dial.children[0]).toHaveClass("idle");
    await expect(within(dial).getByText("8pm")).toBeInTheDocument();
    await expect(within(dial).getByText("peak hour")).toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Evenings are yours — 83% of your recorded time lands between 5pm and 10pm.",
      ),
    ).toBeInTheDocument();

    const days = canvas.getByTestId("stats-when-weekdays");
    await expect(
      Array.from(days.children).map(
        (row) => row.querySelector(".st-day-label")?.textContent,
      ),
    ).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    await expect(days.children[6]).toHaveTextContent("Sun1h 40m");
    await expect(days.children[6]?.querySelector(".st-day-bar")).toHaveClass(
      "hot",
    );
    await expect(
      days.children[6]?.querySelector(".st-day-bar"),
    ).toHaveAttribute("style", "width: 100%;");
    // A quiet day reads as an absence, not a measured zero.
    await expect(days.children[0]).toHaveTextContent("Mon—");
    await expect(days.children[0]?.querySelector(".st-day-bar")).toHaveClass(
      "idle",
    );
  },
};

export const ClockWithNothingPlaceableSaysSo: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inWindow({
        hour_of_day: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          seconds: 0,
        })),
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "No activity with a recorded local time in this period yet.",
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("img", { name: "Activity by hour of day" }),
    ).toBeNull();
  },
};

export const ClockDisclosesActivityWithoutATimezone: Story = {
  beforeEach({ msw }) {
    msw.use(...inWindow({ unzoned_seconds: 420 }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "7m of activity was recorded without a timezone and isn’t shown here.",
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("img", { name: "Activity by hour of day" }),
    ).toBeInTheDocument();
  },
};

export const ClockDisclosesUnzonedActivityUnderItsEmptyState: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inWindow({
        unzoned_seconds: 3600,
        hour_of_day: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          seconds: 0,
        })),
      }),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByText(
      "No activity with a recorded local time in this period yet.",
    );
    await expect(canvas.getByTestId("stats-when-unzoned")).toHaveTextContent(
      "1h of activity was recorded without a timezone",
    );
  },
};

export const DonutShowsTheGenreMix: Story = {
  play: async ({ canvas }) => {
    const donut = await canvas.findByRole("img", {
      name: "Genre share by book count",
    });
    await expect(canvas.getByText("Where the time went")).toBeInTheDocument();
    await expect(donut).toHaveAttribute(
      "style",
      "background: conic-gradient(var(--st-donut-c0) 0% 50%, var(--st-donut-c1) 50% 100%);",
    );
    await expect(within(donut).getByText("4")).toBeInTheDocument();
    await expect(within(donut).getByText("tagged")).toBeInTheDocument();

    const rows = within(canvas.getByTestId("stats-genre-donut")).getAllByRole(
      "listitem",
    );
    await expect(rows).toHaveLength(2);
    await expect(rows[0]).toHaveTextContent("Fantasy50%");
    await expect(rows[1]).toHaveTextContent("Science fiction50%");
    // Five active books, four with a genre: the gap is disclosed, not drawn as a slice.
    await expect(canvas.getByTestId("stats-donut-untagged")).toHaveTextContent(
      "+1 book without a genre",
    );
  },
};

export const DonutFoldsTheTailIntoOther: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inWindow({
        genre_share: [4, 3, 2, 1, 1, 1].map((books, i) => ({
          name: `Genre ${i + 1}`,
          books,
        })),
        genre_tagged_books: 12,
        books_active: 12,
      }),
    );
  },
  play: async ({ canvas }) => {
    await canvas.findByRole("img", { name: "Genre share by book count" });
    const rows = within(canvas.getByTestId("stats-genre-donut")).getAllByRole(
      "listitem",
    );
    await expect(rows.map((row) => row.textContent)).toEqual([
      "Genre 133%",
      "Genre 225%",
      "Genre 317%",
      "Genre 48%",
      "Other17%",
    ]);
    await expect(canvas.queryByTestId("stats-donut-untagged")).toBeNull();
  },
};

export const DonutWithoutTaggedReadingSaysSo: Story = {
  beforeEach({ msw }) {
    msw.use(...inWindow({ genre_share: [], genre_tagged_books: 0 }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No tagged reading in this period yet."),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("img", { name: "Genre share by book count" }),
    ).toBeNull();
    await expect(canvas.queryByTestId("stats-donut-untagged")).toBeNull();
  },
};

export const DonutSplitsReadFromListened: Story = {
  play: async ({ canvas }) => {
    // 54,000 s read against 18,000 s listened.
    await expect(
      await canvas.findByTestId("stats-format-split"),
    ).toHaveTextContent("Read75%Listened25%");
  },
};

export const DonutHasNoSplitWithoutTime: Story = {
  beforeEach({ msw }) {
    msw.use(...inWindow({ reading_seconds: 0, listening_seconds: 0 }));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("stats-genre-donut");
    await expect(canvas.queryByTestId("stats-format-split")).toBeNull();
  },
};

export const DonutBodyRemountsOnlyWhenTheMixChanges: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        stats: ({ range }) =>
          aWireStatsSummary({
            range,
            ...(range === "year"
              ? {
                  genre_share: [{ name: "History", books: 4 }],
                  genre_tagged_books: 4,
                }
              : {}),
          }),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const card = await canvas.findByTestId("stats-genre-donut");
    const first = card.querySelector(".st-spend-body");

    // Lifetime reports the same mix as the month: the body keeps its node and its motion.
    await userEvent.click(canvas.getByRole("button", { name: "Lifetime" }));
    await waitFor(() =>
      expect(canvas.getByTestId("stats-window-label")).toHaveTextContent(
        "Everything you have tracked",
      ),
    );
    await expect(card.querySelector(".st-spend-body")).toBe(first);

    await userEvent.click(canvas.getByRole("button", { name: "Year" }));
    await waitFor(() => expect(card).toHaveTextContent("History100%"));
    await expect(card.querySelector(".st-spend-body")).not.toBe(first);
  },
};

export const StandoutsListEachRecordInOrder: Story = {
  play: async ({ canvas }) => {
    const grid = await canvas.findByTestId("stats-superlatives");
    const cards = within(grid).getAllByTestId("stats-superlative");
    await expect(
      cards.map(
        (card) => card.querySelector(".st-standout-label")?.textContent,
      ),
    ).toEqual([
      "Longest book",
      "Shortest book",
      "Fastest read",
      "Longest sitting",
      "Biggest day",
      "Busiest week",
      "Most-read author",
      "Most-read subject",
    ]);
    await expect(cards[0]).toHaveClass("lead");
    await expect(cards[1]).not.toHaveClass("lead");
    await expect(cards[0]).toHaveTextContent("Aurora Station, Vol. 1612 pages");
    await expect(cards[2]).toHaveTextContent("The Salt Roadin 2 days");
    await expect(cards[3]).toHaveTextContent("Aurora Station, Vol. 12 h");
    await expect(cards[4]).toHaveTextContent("14 Aug 20263 h 20 m");
    await expect(cards[5]).toHaveTextContent("Week of 3 Aug 20266 h");
    await expect(cards[6]).toHaveTextContent("Sora Inkwell8 h 20 m");
    await expect(cards[7]).toHaveTextContent("Space opera6 h 40 m");
  },
};

export const StandoutsStateTheFastestReadFloor: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("stats-superlatives-note"),
    ).toHaveTextContent("at least 30 m of recorded time");
  },
};

export const StandoutsOmitRecordsTheWindowLacks: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inWindow({
        superlatives: {
          longest_book: aWireStatsSummary().superlatives?.longest_book,
        },
        busiest_week_start: null,
        top_authors: [],
        top_tags: [],
      }),
    );
  },
  play: async ({ canvas }) => {
    const grid = await canvas.findByTestId("stats-superlatives");
    await expect(within(grid).getAllByTestId("stats-superlative")).toHaveLength(
      1,
    );
    await expect(canvas.queryByTestId("stats-superlatives-note")).toBeNull();
  },
};

export const StandoutsAreAbsentWhenNothingStandsOut: Story = {
  beforeEach({ msw }) {
    msw.use(...inWindow(NO_STANDOUTS));
  },
  play: async ({ canvas }) => {
    await canvas.findByTestId("stats-genre-donut");
    await expect(canvas.queryByTestId("stats-superlatives")).toBeNull();
  },
};
