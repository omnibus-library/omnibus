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
    // 20:00 is the busiest hour, so it has a full-reach tick at 480deg and the hub names it.
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
    // Five active books, four with a genre. The gap is disclosed, not drawn as a slice.
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

    // Lifetime reports the same mix as the month, so the body keeps its node and its motion.
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

export const SplitPercentRemountsOnlyWhenItsShareChanges: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        stats: ({ range }) =>
          aWireStatsSummary({
            range,
            ...(range === "year"
              ? { reading_seconds: 36_000, listening_seconds: 36_000 }
              : {}),
          }),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const split = await canvas.findByTestId("stats-format-split");
    const shares = () => [...split.querySelectorAll(".st-split-pct")];
    const first = shares();
    await expect(first.map((node) => node.textContent)).toEqual(["75%", "25%"]);

    // Lifetime reports the same split as the month, so each number keeps its node and its fade.
    await userEvent.click(canvas.getByRole("button", { name: "Lifetime" }));
    await waitFor(() =>
      expect(canvas.getByTestId("stats-window-label")).toHaveTextContent(
        "Everything you have tracked",
      ),
    );
    for (const [i, node] of shares().entries()) {
      await expect(node).toBe(first[i]);
    }

    await userEvent.click(canvas.getByRole("button", { name: "Year" }));
    await waitFor(() =>
      expect(shares().map((node) => node.textContent)).toEqual(["50%", "50%"]),
    );
    for (const [i, node] of shares().entries()) {
      await expect(node).not.toBe(first[i]);
    }
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

const FINISHED_TILE = { name: "Expand Finished details" };

export const TilesShowTheFourHeadlineFigures: Story = {
  play: async ({ canvas }) => {
    await canvas.findByRole("button", FINISHED_TILE);
    await expect(
      canvas
        .getAllByRole("button", { name: /^Expand .* details$/ })
        .map((tile) => tile.getAttribute("aria-label")),
    ).toEqual([
      "Expand Finished details",
      "Expand Pages read details",
      "Expand Listening details",
      "Expand How you rated details",
    ]);
    const finished = canvas.getByRole("button", FINISHED_TILE);
    await expect(finished).toHaveClass("accent");
    await expect(finished).toHaveTextContent("3books+1Finished");
    await expect(canvas.getByTestId("stats-tile-finished-delta")).toHaveClass(
      "up",
    );
    await expect(
      canvas.getByRole("button", { name: "Expand Pages read details" }),
    ).toHaveTextContent("1,240pages+38%Pages read");
    await expect(
      canvas.getByRole("button", { name: "Expand Listening details" }),
    ).toHaveTextContent("5.0hours+100%Listening");
    await expect(
      canvas.getByRole("button", { name: "Expand How you rated details" }),
    ).toHaveTextContent("4.3★ avg+0.2How you rated");
    await expect(
      finished.querySelector(".st-tile-fill")?.getAttribute("style"),
    ).toBe("width: 100%;");
  },
};

export const TileDeltasFollowTheDirectionOfChange: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inWindow({
        books_finished: 1,
        previous: {
          books_finished: 3,
          avg_stars: 4.25,
          listening_seconds: 18_000,
          pages_read: 900,
        },
      }),
    );
  },
  play: async ({ canvas }) => {
    const finished = await canvas.findByTestId("stats-tile-finished-delta");
    await expect(finished).toHaveTextContent("−2");
    await expect(finished).toHaveClass("down");
    await expect(canvas.getByTestId("stats-tile-listening-delta")).toHaveClass(
      "flat",
    );
    await expect(
      canvas.getByTestId("stats-tile-listening-delta"),
    ).toHaveTextContent("flat");
  },
};

export const UnratedTileDrawsADashWithNoUnitOrDelta: Story = {
  beforeEach({ msw }) {
    msw.use(...inWindow({ avg_stars: null }));
  },
  play: async ({ canvas }) => {
    const tile = await canvas.findByRole("button", {
      name: "Expand How you rated details",
    });
    await expect(tile).toHaveTextContent(/^—How you rated$/);
    await expect(
      canvas.queryByTestId("stats-tile-avg-rating-delta"),
    ).toBeNull();
    await expect(tile.querySelector(".st-tile-track")).toBeNull();
  },
};

export const LifetimeDropsEveryTileComparison: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("button", FINISHED_TILE);
    await userEvent.click(canvas.getByRole("button", { name: "Lifetime" }));
    await waitFor(() =>
      expect(canvas.getByTestId("stats-window-label")).toHaveTextContent(
        "Everything you have tracked",
      ),
    );
    await expect(canvas.queryByTestId("stats-tile-finished-delta")).toBeNull();
    await expect(canvas.queryByTestId("stats-tile-pages-delta")).toBeNull();
    await expect(canvas.queryByTestId("stats-tile-listening-delta")).toBeNull();
    await expect(
      canvas.queryByTestId("stats-tile-avg-rating-delta"),
    ).toBeNull();
    await expect(document.querySelectorAll(".st-tile-track")).toHaveLength(0);
    await expect(canvas.getByRole("button", FINISHED_TILE)).toHaveTextContent(
      "3booksFinished",
    );
  },
};

async function openSheet(
  canvas: ReturnType<typeof within>,
  userEvent: { click: (element: Element) => Promise<void> },
  tile: string,
  sheet: string,
) {
  await userEvent.click(await canvas.findByRole("button", { name: tile }));
  return canvas.findByRole("dialog", { name: sheet });
}

export const FinishedSheetStatesTheTilesComparisonAndTheBooks: Story = {
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand Finished details",
      "Finished detail",
    );
    await waitFor(() => expect(sheet).toHaveFocus());
    await expect(
      within(sheet).getByTestId("stats-drill-delta"),
    ).toHaveTextContent("▲ +1 vs last month");
    await expect(
      within(sheet).getByRole("img", { name: "Finished trend" }).children,
    ).toHaveLength(12);
    const lengths = within(sheet).getByTestId("stats-length-split");
    await expect(
      within(lengths)
        .getAllByTestId("stats-length-row")
        .map((row) => row.textContent),
    ).toEqual(["Under 2001", "200–4001", "Unknown1"]);
    const books = within(sheet).getByTestId("stats-drill-finished-list");
    await expect(books).toHaveTextContent(
      "Aurora Station, Vol. 1Sora Inkwell4.5 ★",
    );
    await expect(
      within(books).getByRole("img", {
        name: "Cover of Aurora Station, Vol. 1",
      }),
    ).toHaveAttribute(
      "src",
      "/api/thumbs/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0/md",
    );
    // Three finished and one listed, so the rail says it is cut.
    await expect(sheet).toHaveTextContent(
      "Showing the latest 1 of 3 finished books.",
    );
  },
};

export const FinishedSheetWithNothingFinishedSaysSo: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inWindow({
        books_finished: 0,
        finished_books: [],
        length_buckets: [{ label: "Under 200", books: 0 }],
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand Finished details",
      "Finished detail",
    );
    await expect(
      within(sheet).getByText("No books finished in this window."),
    ).toBeInTheDocument();
    await expect(
      within(sheet).getByText("No books finished in this period yet."),
    ).toBeInTheDocument();
    await expect(within(sheet).queryByTestId("stats-length-split")).toBeNull();
  },
};

export const SheetClosesFromTheButtonEscapeAndTheBackdrop: Story = {
  play: async ({ canvas, userEvent }) => {
    const tile = await canvas.findByRole("button", FINISHED_TILE);
    const closers = [
      () => userEvent.click(canvas.getByRole("button", { name: "Close" })),
      () => userEvent.keyboard("{Escape}"),
      () => userEvent.click(canvas.getByRole("dialog")),
    ];

    for (const close of closers) {
      await userEvent.click(tile);
      await waitFor(() => expect(canvas.getByRole("dialog")).toHaveFocus());
      await close();
      await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(tile).toHaveFocus());
    }
  },
};

export const SheetKeepsTheWindowItWasOpenedOn: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        stats: ({ range }) =>
          aWireStatsSummary({
            range,
            ...(range === "year"
              ? {
                  books_finished: 10,
                  previous: {
                    books_finished: 4,
                    avg_stars: 4,
                    listening_seconds: 9000,
                    pages_read: 900,
                  },
                }
              : {}),
          }),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand Finished details",
      "Finished detail",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Year" }));
    await waitFor(() =>
      expect(canvas.getByTestId("stats-tile-finished-delta")).toHaveTextContent(
        "+6",
      ),
    );

    // The tile behind it moved on; the sheet still names the month it was measured over.
    await expect(
      within(sheet).getByTestId("stats-drill-delta"),
    ).toHaveTextContent("▲ +1 vs last month");
  },
};

export const LifetimeSheetHasNothingToCompare: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("button", FINISHED_TILE);
    await userEvent.click(canvas.getByRole("button", { name: "Lifetime" }));
    await waitFor(() =>
      expect(canvas.getByTestId("stats-window-label")).toHaveTextContent(
        "Everything you have tracked",
      ),
    );

    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand Finished details",
      "Finished detail",
    );

    await expect(
      within(sheet).getByTestId("stats-drill-delta"),
    ).toHaveTextContent("Not enough data yet to compare.");
  },
};

export const SwitchingReaderClosesTheSheet: Story = {
  play: async ({ canvas, userEvent }) => {
    await openSheet(
      canvas,
      userEvent,
      "Expand Finished details",
      "Finished detail",
    );

    await userEvent.click(
      canvas.getByRole("button", { name: "Stats for You" }),
    );
    await userEvent.click(canvas.getByTestId("stats-reader-option-2"));

    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
    await expect(await canvas.findByText("Grace's stats")).toBeInTheDocument();
  },
};

export const RatingSheetShowsTheTrendAndTheHistogram: Story = {
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand How you rated details",
      "Avg rating detail",
    );
    await expect(
      within(sheet).getByTestId("stats-drill-delta"),
    ).toHaveTextContent("▲ +0.2 vs last month");
    await expect(
      within(sheet).getByText("Average rating by month"),
    ).toBeInTheDocument();
    await expect(
      within(sheet).getByTestId("stats-drill-trend-caption"),
    ).toHaveTextContent(
      "Jul 2026 – Aug 2026 · the last 12 months, whatever period is selected",
    );
    const trend = within(sheet).getByRole("img", {
      name: "Average rating by month",
    });
    await expect(
      Array.from(
        trend.querySelectorAll("[data-testid=stats-drill-bar-value]"),
      ).map((value) => value.textContent),
    ).toEqual(["4.5", "4.3"]);

    await expect(
      within(sheet).getByTestId("stats-drill-histogram-caption"),
    ).toHaveTextContent("Rated this month");
    const histogram = within(sheet).getByRole("img", {
      name: "Star rating distribution",
    });
    await expect(histogram.children).toHaveLength(10);
    await expect(
      histogram.querySelector('[title="4.5 ★ · 2 books"]'),
    ).toHaveTextContent("2");
  },
};

export const RatingSheetWithNothingRatedSaysSo: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inWindow({
        avg_stars: null,
        rating_monthly: [],
        rating_histogram: Array.from({ length: 10 }, (_, i) => ({
          half_stars: i + 1,
          books: 0,
        })),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand How you rated details",
      "Avg rating detail",
    );
    await expect(
      within(sheet).getByTestId("stats-drill-delta"),
    ).toHaveTextContent("Not enough data yet to compare.");
    await expect(
      within(sheet).getByTestId("stats-drill-histogram-empty"),
    ).toHaveTextContent("No ratings in this window yet.");
    await expect(
      within(sheet).queryByText("Average rating by month"),
    ).toBeNull();
    await expect(
      within(sheet).queryByTestId("stats-drill-histogram"),
    ).toBeNull();
  },
};

export const ListeningSheetTrendsMinutesADay: Story = {
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand Listening details",
      "Listening detail",
    );
    await expect(
      within(sheet).getByTestId("stats-drill-delta"),
    ).toHaveTextContent("▲ +100% vs last month");
    await expect(
      within(sheet).getByRole("img", { name: "Listening trend" }).children,
    ).toHaveLength(1);
    await expect(
      within(sheet).getByTestId("stats-drill-bar-label"),
    ).toHaveTextContent("12");
  },
};

export const PagesSheetStatesTheRateAndWhatItCouldNotMeasure: Story = {
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand Pages read details",
      "Pages read detail",
    );
    await expect(
      within(sheet).getByTestId("stats-drill-pages-rate"),
    ).toHaveTextContent("39 est. pages an hour");
    const note = within(sheet).getByTestId("stats-drill-pages-note");
    await expect(note).toHaveTextContent("Across 3 books this period.");
    await expect(note).toHaveTextContent(
      "1 more book has no known length yet, so nothing it contributed is counted.",
    );
    // The window opens after tracking began, so the date is context, not a caveat.
    await expect(
      within(sheet).getByTestId("stats-drill-pages-cutover"),
    ).toHaveTextContent(/^Page tracking began 2026-01-01\.$/);
  },
};

export const PagesSheetWithoutARateExplainsWhy: Story = {
  beforeEach({ msw }) {
    msw.use(...inWindow({ pages_per_hour: null }));
  },
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand Pages read details",
      "Pages read detail",
    );
    await expect(
      within(sheet).getByTestId("stats-drill-pages-rate"),
    ).toHaveTextContent(
      "No book finished in this window has both a measurable length and recorded reading time yet.",
    );
    await expect(within(sheet).queryByText("Reading speed")).toBeNull();
  },
};

export const PagesSheetOfAnAudioOnlyWindowReadsZero: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inWindow({
        pages_read: null,
        pages_per_hour: null,
        pages_detail: {
          audio_books: 2,
          measured_books: 0,
          unmeasured_books: 0,
          since_day: null,
          daily: [],
          window_predates_ledger: false,
        },
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand Pages read details",
      "Pages read detail",
    );
    await expect(
      canvas.getByRole("button", { name: "Expand Pages read details" }),
    ).toHaveTextContent("0pages−100%Pages read");
    await expect(
      within(sheet).getByTestId("stats-drill-pages-note"),
    ).toHaveTextContent(
      "Only audiobooks this period — listening turns no pages.",
    );
    await expect(
      within(sheet).queryByTestId("stats-drill-pages-cutover"),
    ).toBeNull();
  },
};

export const PagesSheetWarnsWhenTheWindowPredatesTracking: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...inWindow({
        pages_detail: {
          audio_books: 0,
          measured_books: 3,
          unmeasured_books: 0,
          since_day: "2026-01-01",
          daily: [],
          window_predates_ledger: true,
        },
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const sheet = await openSheet(
      canvas,
      userEvent,
      "Expand Pages read details",
      "Pages read detail",
    );
    await expect(
      within(sheet).getByTestId("stats-drill-pages-cutover"),
    ).toHaveTextContent(
      "Page tracking began 2026-01-01; reading before then can’t be counted, so this period is only partly covered.",
    );
    // With no daily series, the empty trend draws nothing.
    await expect(
      within(sheet).queryByRole("img", { name: "Pages read trend" }),
    ).toBeNull();
  },
};
