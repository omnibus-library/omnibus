import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
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
