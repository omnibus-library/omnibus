import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { deferred, hanging } from "../../testing/handlers";
import { aWireChartResult } from "../../testing/statsHandlers";
import { api, calls, Page } from "./StatsChart.stories.shared";

const TICK_ORDER = [
  "Books finished",
  "Avg book length",
  "Avg rating",
  "Reading minutes",
  "Listening minutes",
  "Sittings",
  "Avg sitting length",
  "Pages read",
];

/** Books as bars on the left scale, average length as a line on the right with a gap in it. */
const TWO_UNITS = aWireChartResult({
  series: [
    { measure: "books_finished", axis: 0, mark: "bar", values: [1, 2, 3] },
    {
      measure: "avg_page_length",
      axis: 1,
      mark: "line",
      values: [320, null, 180],
    },
  ],
  axes: [
    { unit: "books", max: 4 },
    { unit: "pages", max: 400 },
  ],
});

const SPLIT = aWireChartResult({
  series: ["Fantasy", "Horror"].map((slice) => ({
    measure: "books_finished" as const,
    slice,
    axis: 0,
    mark: "bar" as const,
    values: [1, 2, 3],
  })),
  stacked: true,
});

const NOTHING = aWireChartResult({
  series: [
    {
      measure: "avg_rating",
      axis: 0,
      mark: "line",
      values: [null, null, null],
    },
  ],
  axes: [{ unit: "stars", max: 1 }],
});

const meta = {
  title: "Pages/Stats chart",
  component: Page,
  parameters: { path: "/stats/chart" },
  beforeEach({ msw }) {
    msw.use(...api());
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpensOnAnEmptyPicker: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Chart builder" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/^Pick what to plot\./)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Omnibus | Chart builder"));

    const boxes = within(
      canvas.getByRole("group", { name: "Measures" }),
    ).getAllByRole("checkbox");
    await expect(boxes).toHaveLength(TICK_ORDER.length);
    for (const [i, box] of boxes.entries()) {
      await expect(box).toHaveAccessibleName(TICK_ORDER[i]);
      await expect(box).not.toBeChecked();
    }
    await expect(canvas.getByText("books · per book finished")).toBeVisible();
    // The three sitting measures all read the same.
    await expect(canvas.getAllByText("minutes · per sitting")).toHaveLength(3);

    await expect(canvas.getByTestId("chart-prompt")).toHaveTextContent(
      "Nothing plotted yet — tick a measure above and it'll appear here.",
    );
    await expect(canvas.queryByTestId("chart-canvas")).toBeNull();
    await expect(calls.chart).toHaveLength(0);
  },
};

export const TickingAMeasureAsksForThatChartOnTheDeviceCalendar: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Books finished" }),
    );

    await expect(await canvas.findByTestId("chart-canvas")).toBeVisible();
    await expect(calls.specs).toEqual([
      {
        measures: ["books_finished"],
        bucket: "month",
        range: "year",
        breakdown: "none",
      },
    ]);
    await expect(calls.chart[0]?.get("utc_offset_minutes")).toBe(
      String(-new Date().getTimezoneOffset()),
    );
  },
};

export const ScalesHintAndDisabledUnitsFollowTheSelection: Story = {
  play: async ({ canvas, userEvent }) => {
    const hint = canvas.getByTestId("chart-scales");
    const box = (name: string) => canvas.getByRole("checkbox", { name });
    await expect(hint).toHaveTextContent(
      "Nothing plotted yet — anything in the list can join.",
    );

    await userEvent.click(box("Books finished"));
    await expect(hint).toHaveTextContent(
      "One scale in use — anything else can still join.",
    );

    await userEvent.click(box("Avg book length"));
    await expect(hint).toHaveTextContent(
      "Both scales in use. Measures in other units are greyed out until you free one.",
    );
    for (const name of [
      "Avg rating",
      "Reading minutes",
      "Listening minutes",
      "Sittings",
      "Avg sitting length",
    ]) {
      await expect(box(name)).toBeDisabled();
    }
    // A second pages measure joins the scale pages already own, and a ticked box can still come off.
    for (const name of ["Pages read", "Books finished", "Avg book length"]) {
      await expect(box(name)).toBeEnabled();
    }

    await userEvent.click(box("Books finished"));
    await userEvent.click(box("Avg book length"));
    await expect(canvas.getByTestId("chart-prompt")).toBeVisible();
    await expect(canvas.queryByTestId("chart-canvas")).toBeNull();
  },
};

export const GroupByAndPeriodShowTheChoiceAndRefetch: Story = {
  play: async ({ canvas, userEvent }) => {
    const groupBy = canvas.getByLabelText("Group by");
    const period = canvas.getByLabelText("Period");
    await expect(groupBy).toHaveDisplayValue("Monthly");
    await expect(period).toHaveDisplayValue("Year");
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Books finished" }),
    );
    await waitFor(() => expect(calls.specs).toHaveLength(1));

    await userEvent.selectOptions(groupBy, "Weekly");
    await waitFor(() => expect(calls.specs).toHaveLength(2));
    await userEvent.selectOptions(period, "Lifetime");
    await waitFor(() => expect(calls.specs).toHaveLength(3));

    await expect(calls.specs.at(-1)).toMatchObject({
      measures: ["books_finished"],
      bucket: "week",
      range: "all_time",
    });
    await expect(groupBy).toHaveDisplayValue("Weekly");
    await expect(period).toHaveDisplayValue("Lifetime");
  },
};

export const SplitNeedsOneMeasureThatBelongsToABook: Story = {
  play: async ({ canvas, userEvent }) => {
    const split = canvas.getByLabelText("Split");
    const box = (name: string) => canvas.getByRole("checkbox", { name });
    await expect(split).toBeDisabled();
    await expect(canvas.getByText("one measure only")).toBeVisible();

    await userEvent.click(box("Reading minutes"));
    await expect(split).toBeDisabled();
    await expect(
      canvas.getByText("only per-book measures split"),
    ).toBeVisible();
    await userEvent.click(box("Reading minutes"));

    await userEvent.click(box("Books finished"));
    await expect(split).toBeEnabled();
    await expect(canvas.getByText("top genres, rest folded")).toBeVisible();
    await userEvent.selectOptions(split, "By genre");
    await waitFor(() =>
      expect(calls.specs.at(-1)).toMatchObject({ breakdown: "genre" }),
    );

    // A second measure leaves nothing for the split to describe.
    await userEvent.click(box("Avg rating"));
    await expect(split).toBeDisabled();
    await expect(split).toHaveDisplayValue("No split");
    await waitFor(() =>
      expect(calls.specs.at(-1)).toEqual({
        measures: ["books_finished", "avg_rating"],
        bucket: "month",
        range: "year",
        breakdown: "none",
      }),
    );
  },
};

export const HoldsTheLoaderUntilTheFirstChartAnswers: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/stats/chart", "post"));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Books finished" }),
    );

    await expect(
      await canvas.findByText("Drawing the chart"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("chart-canvas")).toBeNull();
  },
};

let held = deferred();

export const KeepsTheLastChartDimmedWhileTheNextOneLoads: Story = {
  beforeEach({ msw }) {
    held = deferred();
    msw.use(
      ...api({
        chart: async ({ measures }) => {
          if (measures.length > 1) await held.promise;
          return TWO_UNITS;
        },
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Books finished" }),
    );
    const settled = await canvas.findByTestId("chart-canvas");
    await expect(settled).toHaveAttribute("aria-busy", "false");

    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Avg book length" }),
    );

    await expect(settled).toHaveClass(
      "cb-canvas",
      "ld-stale",
      "is-stale",
      "is-loading",
    );
    await expect(settled).toHaveAttribute("aria-busy", "true");
    await expect(canvas.getByTestId("chart-legend")).toBeVisible();
    await expect(canvas.queryByText("Drawing the chart")).toBeNull();

    held.release();
    await waitFor(() => expect(settled).toHaveAttribute("aria-busy", "false"));
    await expect(settled).not.toHaveClass("is-stale", "is-loading");
  },
};

export const EmptyingTheSelectionDropsTheChartFromBefore: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...api({
        chart: async ({ measures }) => {
          // Nothing but the first chart ever answers, so a second one on screen can only be the old one.
          if (measures.includes("reading_minutes")) {
            await new Promise<never>(() => {});
          }
          return TWO_UNITS;
        },
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const box = (name: string) => canvas.getByRole("checkbox", { name });
    await userEvent.click(box("Books finished"));
    await expect(await canvas.findByTestId("chart-legend")).toBeVisible();

    await userEvent.click(box("Books finished"));
    await expect(canvas.getByTestId("chart-prompt")).toBeVisible();
    await userEvent.click(box("Reading minutes"));

    await expect(
      await canvas.findByText("Drawing the chart"),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("chart-legend")).toBeNull();
  },
};

export const ARejectedSpecShowsTheServersMessage: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/stats/chart",
        () =>
          new HttpResponse("Reading minutes is already on this chart", {
            status: 422,
          }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Reading minutes" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Reading minutes is already on this chart",
    );
    await userEvent.click(
      canvas.getByRole("link", { name: "Back to your stats" }),
    );
    await expect(
      await canvas.findByRole("heading", { name: "Stats" }),
    ).toBeVisible();
  },
};

export const NothingRecordedSaysSoInsteadOfDrawingAnEmptyChart: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => NOTHING }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("checkbox", { name: "Avg rating" }));

    await expect(await canvas.findByTestId("chart-empty")).toHaveTextContent(
      "Nothing recorded in this period yet. Try a wider period, or a measure you've got data for.",
    );
    await expect(canvas.queryByTestId("chart-legend")).toBeNull();
  },
};

export const LegendNamesEachSeriesAndItsScale: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => TWO_UNITS }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Books finished" }),
    );

    const rows = within(await canvas.findByTestId("chart-legend")).getAllByRole(
      "listitem",
    );
    await expect(rows.map((row) => row.textContent)).toEqual([
      "Books finishedleft",
      "Avg book lengthright",
    ]);
    const swatches = rows.map((row) => row.querySelector(".cb-legend-swatch"));
    await expect(swatches.map((s) => s?.getAttribute("data-mark"))).toEqual([
      "bar",
      "line",
    ]);
    await expect(swatches[0]).toHaveClass("cb-s0");
    await expect(swatches[1]).toHaveClass("cb-s1");
  },
};

export const LegendQualifiesASplitAndDropsTheScaleMarker: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => SPLIT }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Books finished" }),
    );

    const legend = await canvas.findByTestId("chart-legend");
    await expect(
      within(legend)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Books finished · Fantasy", "Books finished · Horror"]);
  },
};

export const TableListsEveryNumberAndSaysWhenThereIsNone: Story = {
  beforeEach({ msw }) {
    msw.use(...api({ chart: () => TWO_UNITS }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Books finished" }),
    );
    await userEvent.click(await canvas.findByText("Show the numbers"));

    const table = canvas.getByRole("table", { name: "Chart data" });
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Period", "Books finished", "Avg book length"]);
    await expect(
      within(table)
        .getAllByRole("row")
        .map((row) => row.textContent),
    ).toEqual([
      "PeriodBooks finishedAvg book length",
      "Jun1320",
      "Jul2no data",
      "Aug3180",
    ]);
  },
};
