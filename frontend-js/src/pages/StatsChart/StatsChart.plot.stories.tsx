import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import type { ChartResult } from "../../api";
import { aWireChartResult } from "../../testing/statsHandlers";
import { api, Page } from "./StatsChart.stories.shared";

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = Array.from({ length: 12 }, (_, i) => `2026-${pad(i + 1)}`);

/** Books as bars on the left scale, average rating as a line on the right; March has books and no rating. */
const BOOKS_AND_RATING = aWireChartResult({
  buckets: MONTHS,
  series: [
    {
      measure: "books_finished",
      axis: 0,
      mark: "bar",
      values: [1, 2, 3, 0, 4, 2, 1, 3, 2, 1, 0, 2],
    },
    {
      measure: "avg_rating",
      axis: 1,
      mark: "line",
      values: [4, 4.5, null, 3.5, 4, 4, 4.5, null, 4, 5, 4, 4.5],
    },
  ],
  axes: [
    { unit: "books", max: 4 },
    { unit: "stars", max: 5 },
  ],
});

const BOOKS_ONLY = aWireChartResult({
  buckets: MONTHS,
  series: [
    {
      measure: "books_finished",
      axis: 0,
      mark: "bar",
      values: [1, 2, 3, 0, 4, 2, 1, 3, 2, 1, 0, 2],
    },
  ],
  axes: [{ unit: "books", max: 4 }],
});

const genres = (stacked: boolean) =>
  aWireChartResult({
    buckets: ["2026-01", "2026-02", "2026-03"],
    series: [
      {
        measure: "books_finished",
        slice: "Fantasy",
        axis: 0,
        mark: "bar",
        values: [2, 1, 0],
      },
      {
        measure: "books_finished",
        slice: "Horror",
        axis: 0,
        mark: "bar",
        values: [1, 2, 1],
      },
    ],
    axes: [{ unit: "books", max: 6 }],
    stacked,
  });

/** Six months of ratings with a gap in the middle, so the line breaks in two. */
const RATINGS_WITH_A_GAP = aWireChartResult({
  buckets: MONTHS.slice(0, 6),
  series: [
    {
      measure: "avg_rating",
      axis: 0,
      mark: "line",
      values: [4, 4.5, null, 3.5, 4, 4.5],
    },
  ],
  axes: [{ unit: "stars", max: 5 }],
});

const WEEKS = aWireChartResult({
  bucket: "week",
  buckets: ["2026-02-24", "2026-03-03"],
  series: [{ measure: "books_finished", axis: 0, mark: "bar", values: [1, 2] }],
  axes: [{ unit: "books", max: 2 }],
});

/** `n` daily buckets of reading minutes, one more minute each day. */
const days = (n: number): ChartResult =>
  aWireChartResult({
    bucket: "day",
    buckets: Array.from({ length: n }, (_, i) => `2026-03-${pad(i + 1)}`),
    series: [
      {
        measure: "reading_minutes",
        axis: 0,
        mark: "bar",
        values: Array.from({ length: n }, (_, i) => i),
      },
    ],
    axes: [{ unit: "minutes", max: 40 }],
  });

/** Seven quiet months and one tall one: the axis is sized for 400, so a zoom on the quiet stretch has to refit it. */
const TALL_LAST = aWireChartResult({
  buckets: MONTHS.slice(0, 8),
  series: [
    {
      measure: "books_finished",
      axis: 0,
      mark: "bar",
      values: [2, 2, 2, 2, 2, 2, 2, 400],
    },
  ],
  axes: [{ unit: "books", max: 400 }],
});

const BY_WEEK = aWireChartResult({
  bucket: "week",
  buckets: ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23"],
  series: [
    { measure: "books_finished", axis: 0, mark: "bar", values: [1, 2, 3, 4] },
  ],
  axes: [{ unit: "books", max: 4 }],
});

/** The same months as BOOKS_ONLY with every bar at the top of its axis. */
const ALL_FOUR = aWireChartResult({
  ...BOOKS_ONLY,
  series: [
    {
      measure: "books_finished",
      axis: 0,
      mark: "bar",
      values: Array.from({ length: 12 }, () => 4),
    },
  ],
});

const meta = {
  title: "Pages/Stats chart/Plot",
  component: Page,
  parameters: { path: "/stats/chart" },
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => BOOKS_AND_RATING }));
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;
type Play = Pick<
  Parameters<NonNullable<Story["play"]>>[0],
  "canvas" | "userEvent"
>;

/** Ticks a measure, and waits for the plot the fake API answers with. */
async function drawn({ canvas, userEvent }: Play) {
  await userEvent.click(
    canvas.getByRole("checkbox", { name: "Books finished" }),
  );
  return canvas.findByRole("img", { name: /^Chart of / });
}

function bucketHit(plot: Element, i: number) {
  const hit = plot.querySelectorAll(".cb-hit")[i];
  if (!hit) throw new Error(`the plot has no bucket ${i}`);
  return hit;
}

const texts = (nodes: Iterable<Element>) =>
  [...nodes].map((node) => node.textContent);

const xOf = (nodes: Iterable<Element>) =>
  [...nodes].map((node) => node.getAttribute("x"));

export const NamesWhatItDrawsAndFramesTheGridlines: Story = {
  play: async (ctx) => {
    const plot = await drawn(ctx);

    await expect(plot).toHaveAccessibleName(
      "Chart of Books finished, Avg rating over 12 periods",
    );
    await expect(plot).toHaveAttribute("viewBox", "0 0 760 340");
    await expect(plot).toHaveAttribute("preserveAspectRatio", "none");
    await expect(plot.querySelectorAll(".cb-grid")).toHaveLength(5);
    await expect(texts(plot.querySelectorAll(".cb-tick-left"))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
    // 1.25 and 3.75 are exact ties, which round to the even tenth.
    await expect(texts(plot.querySelectorAll(".cb-tick-right"))).toEqual([
      "0",
      "1.2",
      "2.5",
      "3.8",
      "5",
    ]);
  },
};

export const OneScaleDrawsNoRightTicks: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => BOOKS_ONLY }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    await expect(plot.querySelectorAll(".cb-tick-left")).toHaveLength(5);
    await expect(plot.querySelectorAll(".cb-tick-right")).toHaveLength(0);
  },
};

export const FallsBackToFourGridlinesWhenTheResultNamesNone: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => ({ ...BOOKS_ONLY, divisions: 0 }) }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    await expect(plot.querySelectorAll(".cb-grid")).toHaveLength(5);
    await expect(texts(plot.querySelectorAll(".cb-tick-left"))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
  },
};

export const GroupedBarsTakeOneLanePerSeries: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => genres(false) }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    const bars = xOf(plot.querySelectorAll(".cb-bar"));
    await expect(bars).toHaveLength(6);
    await expect(new Set(bars).size).toBe(6);
  },
};

export const StackedBarsShareOneLanePerBucket: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => genres(true) }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    const bars = xOf(plot.querySelectorAll(".cb-bar"));
    await expect(bars).toHaveLength(6);
    await expect(new Set(bars).size).toBe(3);
  },
};

export const LineBreaksAtAGapAndKeepsADotPerValue: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => RATINGS_WITH_A_GAP }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    // Runs of two and three points; the gap between them is not bridged.
    await expect(plot.querySelectorAll(".cb-stroke")).toHaveLength(2);
    await expect(plot.querySelectorAll(".cb-area")).toHaveLength(2);
    await expect(plot.querySelectorAll(".cb-dot")).toHaveLength(5);
  },
};

export const ThinsTheLabelsAndStaggersTheBars: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => days(30) }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    const labels = texts(plot.querySelectorAll(".cb-xlabel"));
    await expect(labels).toHaveLength(10);
    await expect(labels.slice(0, 3)).toEqual(["1 Mar", "4 Mar", "7 Mar"]);

    const bars = [...plot.querySelectorAll(".cb-bar")];
    await expect(bars[0]?.getAttribute("style")).toContain("--cb-delay: 0ms");
    await expect(bars[1]?.getAttribute("style")).toContain("--cb-delay: 18ms");
    // The stagger stops growing, so a wide chart still settles quickly.
    await expect(bars[29]?.getAttribute("style")).toContain(
      "--cb-delay: 320ms",
    );
  },
};

export const HoverReadsEveryAxisAtTheBucket: Story = {
  play: async (ctx) => {
    const plot = await drawn(ctx);

    await ctx.userEvent.hover(bucketHit(plot, 2));

    const tip = await ctx.canvas.findByRole("status");
    await expect(within(tip).getByText("Mar 2026")).toBeInTheDocument();
    await expect(texts(within(tip).getAllByRole("listitem"))).toEqual([
      "Books finished3 books",
      "Avg ratingno data",
    ]);
    await expect(plot.querySelectorAll(".cb-band")).toHaveLength(1);
  },
};

export const HoverDimsTheOtherBarsAndEnlargesItsDots: Story = {
  play: async (ctx) => {
    const plot = await drawn(ctx);

    await ctx.userEvent.hover(bucketHit(plot, 4));

    await expect(await ctx.canvas.findByRole("status")).toBeInTheDocument();
    await expect(plot.querySelectorAll(".cb-bar.is-dim")).toHaveLength(11);
    await expect(plot.querySelectorAll(".cb-bar:not(.is-dim)")).toHaveLength(1);
    const lit = plot.querySelectorAll(".cb-dot.is-on");
    await expect(lit).toHaveLength(1);
    await expect(lit[0]).toHaveAttribute("r", "5.5");
    await expect(
      plot.querySelectorAll(".cb-dot:not(.is-on)")[0],
    ).toHaveAttribute("r", "4");
  },
};

export const WeekCardNamesTheDayItStartsOn: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => WEEKS }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    await ctx.userEvent.hover(bucketHit(plot, 1));

    await expect(
      within(await ctx.canvas.findByRole("status")).getByText("Week of 3 Mar"),
    ).toBeInTheDocument();
  },
};

export const StackedCardOmitsASliceThatDrawsNothing: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => genres(true) }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    await ctx.userEvent.hover(bucketHit(plot, 2));

    const tip = await ctx.canvas.findByRole("status");
    await expect(texts(within(tip).getAllByRole("listitem"))).toEqual([
      "Books finished · Horror1 books",
    ]);
  },
};

export const GroupedCardKeepsARealZero: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => genres(false) }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    await ctx.userEvent.hover(bucketHit(plot, 2));

    const tip = await ctx.canvas.findByRole("status");
    await expect(texts(within(tip).getAllByRole("listitem"))).toEqual([
      "Books finished · Fantasy0 books",
      "Books finished · Horror1 books",
    ]);
  },
};

export const CardFlipsPastTheMiddleOfThePlot: Story = {
  play: async (ctx) => {
    const plot = await drawn(ctx);

    await ctx.userEvent.hover(bucketHit(plot, 0));
    const near = await ctx.canvas.findByRole("status");
    await expect(near).not.toHaveClass("is-flipped");
    await expect(near.getAttribute("style")).toContain("left: 10.92%");

    await ctx.userEvent.hover(bucketHit(plot, 11));
    await expect(await ctx.canvas.findByRole("status")).toHaveClass(
      "is-flipped",
    );
  },
};

export const LeavingThePlotClearsTheHover: Story = {
  play: async (ctx) => {
    const plot = await drawn(ctx);
    await ctx.userEvent.hover(bucketHit(plot, 3));
    await expect(await ctx.canvas.findByRole("status")).toBeInTheDocument();

    await ctx.userEvent.unhover(plot);

    await expect(ctx.canvas.queryByRole("status")).toBeNull();
    await expect(plot.querySelectorAll(".cb-band")).toHaveLength(0);
    await expect(plot.querySelectorAll(".cb-bar.is-dim")).toHaveLength(0);
  },
};

async function openNotes({ canvas, userEvent }: Play) {
  await userEvent.click(await canvas.findByText("What this chart shows"));
  return canvas.getByTestId("chart-notes");
}

export const NotesDescribeEachMeasureAndTheScalesOnScreen: Story = {
  play: async (ctx) => {
    await drawn(ctx);
    const notes = within(await openNotes(ctx));

    await expect(texts(notes.getAllByRole("term"))).toEqual([
      "Books finished",
      "Avg rating",
    ]);
    await expect(texts(notes.getAllByRole("definition"))).toEqual([
      "Books you marked finished — counted once each, however you marked them. Measured per book finished, in books.",
      "Stars you gave, averaged over the books you rated. Measured per rating, in stars.",
    ]);
    await expect(notes.getByTestId("chart-notes-scales")).toHaveTextContent(
      "books on the left, stars on the right",
    );
    await expect(
      notes.getByTestId("chart-notes-availability"),
    ).toHaveTextContent("books and stars have both");
    await expect(
      notes.getByText(/^A quiet period reads as zero/),
    ).toBeInTheDocument();
    await expect(notes.getByTestId("chart-notes-zoom")).toHaveTextContent(
      "Drag across the chart to zoom into a stretch of it.",
    );
    await expect(notes.queryByTestId("chart-caveat")).toBeNull();
    await expect(notes.queryByTestId("chart-truncated")).toBeNull();
  },
};

export const NotesNameASplitMeasureOnce: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => genres(true) }));
  },
  play: async (ctx) => {
    await drawn(ctx);
    const notes = within(await openNotes(ctx));

    await expect(texts(notes.getAllByRole("term"))).toEqual(["Books finished"]);
    await expect(notes.getByText(/the slices stack/)).toBeInTheDocument();
  },
};

export const NotesListCaveatsAndSayWhenTheAxisWasClipped: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        chart: () => ({
          ...BOOKS_AND_RATING,
          truncated: true,
          caveats: [
            "Ratings are bucketed by when the book was rated, not when it was finished.",
          ],
        }),
      }),
    );
  },
  play: async (ctx) => {
    await drawn(ctx);
    const notes = within(await openNotes(ctx));

    await expect(
      notes.getByText("What these numbers can't tell you"),
    ).toBeInTheDocument();
    await expect(texts(notes.getAllByTestId("chart-caveat"))).toEqual([
      "Ratings are bucketed by when the book was rated, not when it was finished.",
    ]);
    await expect(notes.getByTestId("chart-truncated")).toHaveTextContent(
      "only the most recent 366 periods are shown.",
    );
    await expect(notes.getByTestId("chart-notes-zoom")).toHaveTextContent(
      "it can't reach past the ones this axis had to clip",
    );
  },
};

export const NotesHaveNothingToDescribeWithoutAChart: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        chart: () => ({ ...BOOKS_ONLY, buckets: [], series: [], axes: [] }),
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Books finished" }),
    );

    await expect(await canvas.findByTestId("chart-empty")).toBeInTheDocument();
    await expect(canvas.queryByTestId("chart-notes")).toBeNull();
  },
};

// user-event sends `mouseout` with no relatedTarget, which React reads as leaving the plot and so abandons
// the drag; these send the events a browser does.
function moveTo(to: Element, from: Element | null) {
  if (from) fireEvent.mouseOut(from, { relatedTarget: to });
  fireEvent.mouseOver(to, { relatedTarget: from });
}

/** Presses on bucket `from`, drags to `to` and lets go. */
function drag(plot: Element, from: number, to: number) {
  const [start, end] = [bucketHit(plot, from), bucketHit(plot, to)];
  moveTo(start, null);
  fireEvent.mouseDown(start);
  if (start !== end) moveTo(end, start);
  fireEvent.mouseUp(end);
}

const xLabels = (plot: Element) => texts(plot.querySelectorAll(".cb-xlabel"));

export const DraggingAcrossBucketsZoomsToThemAndRefitsTheAxis: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => TALL_LAST }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    drag(plot, 0, 3);

    await expect(
      await ctx.canvas.findByText("Zoomed to 4 of 8 periods"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(xLabels(plot)).toEqual(["Jan 26", "Feb", "Mar", "Apr"]),
    );
    // A slice topping out at 2 refits to 2, not the 400 the whole range needed.
    await expect(texts(plot.querySelectorAll(".cb-tick-left"))).toEqual([
      "0",
      "1",
      "2",
    ]);
  },
};

export const ShowAllLeavesTheZoom: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => TALL_LAST }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);
    drag(plot, 0, 3);

    await ctx.userEvent.click(
      await ctx.canvas.findByRole("button", { name: "Show all" }),
    );

    await expect(ctx.canvas.queryByText(/^Zoomed to/)).toBeNull();
    await waitFor(() => expect(xLabels(plot)).toHaveLength(8));
  },
};

export const AClickIsNotAZoom: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => TALL_LAST }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    drag(plot, 2, 2);

    await expect(ctx.canvas.queryByText(/^Zoomed to/)).toBeNull();
    await expect(xLabels(plot)).toHaveLength(8);
  },
};

export const ADragThatLeavesThePlotIsNotAZoom: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => TALL_LAST }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);
    const [start, wandered, back] = [1, 3, 5].map((i) => bucketHit(plot, i));
    if (!start || !wandered || !back) throw new Error("the plot is too short");

    moveTo(start, null);
    fireEvent.mouseDown(start);
    moveTo(wandered, start);
    fireEvent.mouseOut(wandered, { relatedTarget: document.body });
    // Coming back and letting go doesn't commit a drag the plot had already abandoned.
    moveTo(back, null);
    fireEvent.mouseUp(back);

    await expect(ctx.canvas.queryByText(/^Zoomed to/)).toBeNull();
    await expect(xLabels(plot)).toHaveLength(8);
  },
};

export const DraggingDrawsTheBrushOverTheBucketsItCovers: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => TALL_LAST }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);
    const [start, end] = [bucketHit(plot, 0), bucketHit(plot, 3)];

    moveTo(start, null);
    fireEvent.mouseDown(start);
    moveTo(end, start);

    // A 686-wide plot over 8 buckets is 85.75 a band; four of them, from the plot's left edge.
    const brush = await waitFor(() => {
      const rect = plot.querySelector(".cb-brush");
      if (!rect) throw new Error("no brush yet");
      return rect;
    });
    await expect(brush).toHaveAttribute("x", "56.0");
    await expect(brush).toHaveAttribute("width", "343.0");
    fireEvent.mouseUp(end);
    await waitFor(() => expect(plot.querySelector(".cb-brush")).toBeNull());
  },
};

export const ABrushInsideAZoomNarrowsIt: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => TALL_LAST }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);
    drag(plot, 0, 5);
    await ctx.canvas.findByText("Zoomed to 6 of 8 periods");
    await waitFor(() => expect(xLabels(plot)).toHaveLength(6));

    drag(plot, 1, 3);

    await expect(
      await ctx.canvas.findByText("Zoomed to 3 of 8 periods"),
    ).toBeInTheDocument();
    await waitFor(() => expect(xLabels(plot)).toEqual(["Feb", "Mar", "Apr"]));
  },
};

export const ABrushThatZoomsLeavesNoHoverCardBehind: Story = {
  play: async (ctx) => {
    const plot = await drawn(ctx);

    drag(plot, 5, 1);

    await ctx.canvas.findByText("Zoomed to 5 of 12 periods");
    await expect(ctx.canvas.queryByRole("status")).toBeNull();
    await expect(plot.querySelectorAll(".cb-band")).toHaveLength(0);
  },
};

export const ABrushToTheLastBucketLeavesNoBandPastThePlot: Story = {
  play: async (ctx) => {
    const plot = await drawn(ctx);

    drag(plot, 1, 11);

    // Eleven buckets remain, so the bucket the pointer let go over no longer exists.
    await ctx.canvas.findByText("Zoomed to 11 of 12 periods");
    await expect(plot.querySelectorAll(".cb-band")).toHaveLength(0);
  },
};

export const RegroupingDropsAZoomWhoseKeysAreGone: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        chart: ({ bucket }) => (bucket === "week" ? BY_WEEK : TALL_LAST),
      }),
    );
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);
    drag(plot, 0, 3);
    await ctx.canvas.findByText("Zoomed to 4 of 8 periods");

    await ctx.userEvent.selectOptions(
      ctx.canvas.getByLabelText("Group by"),
      "Weekly",
    );

    await waitFor(() =>
      expect(xLabels(plot)).toEqual(["2 Mar", "9 Mar", "16 Mar", "23 Mar"]),
    );
    await expect(ctx.canvas.queryByText(/^Zoomed to/)).toBeNull();
  },
};

export const AZoomDroppedByARegroupStaysGoneWhenTheKeysReturn: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        chart: ({ bucket }) => (bucket === "week" ? BY_WEEK : TALL_LAST),
      }),
    );
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);
    drag(plot, 0, 3);
    await ctx.canvas.findByText("Zoomed to 4 of 8 periods");
    const groupBy = ctx.canvas.getByLabelText("Group by");
    await ctx.userEvent.selectOptions(groupBy, "Weekly");
    await waitFor(() => expect(xLabels(plot)).toHaveLength(4));

    await ctx.userEvent.selectOptions(groupBy, "Monthly");

    await waitFor(() => expect(xLabels(plot)).toHaveLength(8));
    await expect(ctx.canvas.queryByText(/^Zoomed to/)).toBeNull();
  },
};

const barHeights = (plot: Element) =>
  [...plot.querySelectorAll(".cb-bar")].map((bar) =>
    bar.getAttribute("height"),
  );

export const FirstPaintDrawsTheBarsAtFullHeight: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => BOOKS_ONLY }));
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);

    // 3 of an axis of 4, over a 280-tall plot, with no tween to wait out.
    await expect(barHeights(plot)[2]).toBe("210.0");
  },
};

export const ASpecChangeMovesTheBarsToTheNewValues: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        chart: ({ measures }) => (measures.length > 1 ? ALL_FOUR : BOOKS_ONLY),
      }),
    );
  },
  play: async (ctx) => {
    const plot = await drawn(ctx);
    await expect(barHeights(plot)[0]).toBe("70.0");

    await ctx.userEvent.click(
      ctx.canvas.getByRole("checkbox", { name: "Avg book length" }),
    );

    await waitFor(() => expect(barHeights(plot)[0]).toBe("280.0"));
    await expect(new Set(barHeights(plot))).toEqual(new Set(["280.0"]));
  },
};
