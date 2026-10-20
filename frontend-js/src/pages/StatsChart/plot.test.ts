import { describe, expect, it } from "vitest";
import type { ChartResult, ChartSeries } from "../../api";
import {
  axisMax,
  bucketLabel,
  bucketTitle,
  lineRuns,
  monotonePath,
  PAD_L,
  PAD_R_DUAL,
  PAD_R_SINGLE,
  PAD_T,
  plotGeometry,
  stackOffsets,
  tickLabel,
  VIEW_W,
  valueLabel,
} from "./plot";

const series = (
  measure: ChartSeries["measure"],
  values: (number | null)[],
  overrides: Partial<ChartSeries> = {},
): ChartSeries => ({
  measure,
  slice: null,
  axis: 0,
  mark: "bar",
  values,
  ...overrides,
});

/** Books finished (bars, left) against average length (line, right), the comparison the builder exists for, with a gap in the average. */
const SAMPLE: ChartResult = {
  bucket: "month",
  buckets: ["2026-01", "2026-02", "2026-03", "2026-04"],
  series: [
    series("books_finished", [2, 1, 0, 3]),
    series("avg_page_length", [320, 280, null, 180], {
      axis: 1,
      mark: "line",
    }),
  ],
  axes: [
    { unit: "books", max: 5 },
    { unit: "pages", max: 500 },
  ],
  divisions: 4,
  stacked: false,
  truncated: false,
  caveats: [],
};

const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThan(0.001);

describe("bucketLabel", () => {
  it("renders each granularity in its own shape", () => {
    expect(bucketLabel("2026", "year")).toBe("2026");
    expect(bucketLabel("2026-03", "month")).toBe("Mar");
    // January carries the year so a multi-year axis stays readable.
    expect(bucketLabel("2026-01", "month")).toBe("Jan 26");
    expect(bucketLabel("2026-03-14", "day")).toBe("14 Mar");
    expect(bucketLabel("2026-03-09", "week")).toBe("9 Mar");
  });

  it("falls back to the raw key when it cannot parse one", () => {
    expect(bucketLabel("nonsense", "month")).toBe("nonsense");
    expect(bucketLabel("2026-13", "month")).toBe("2026-13");
    expect(bucketLabel("2026-99-01", "day")).toBe("2026-99-01");
  });
});

describe("bucketTitle", () => {
  it("names the year the axis label drops", () => {
    expect(bucketTitle("2026-03", "month")).toBe("Mar 2026");
    expect(bucketTitle("2026-01", "month")).toBe("Jan 2026");
  });

  it("introduces a week by the day it starts on", () => {
    expect(bucketTitle("2026-03-03", "week")).toBe("Week of 3 Mar");
  });

  it("reads a day or a year as its axis label does", () => {
    expect(bucketTitle("2026-03-14", "day")).toBe("14 Mar");
    expect(bucketTitle("2026", "year")).toBe("2026");
  });
});

describe("valueLabel", () => {
  it("rounds a near integer but keeps a real fraction", () => {
    expect(valueLabel(3)).toBe("3");
    expect(valueLabel(3.02)).toBe("3");
    expect(valueLabel(4.5)).toBe("4.5");
    expect(valueLabel(320)).toBe("320");
  });

  it("settles a one-decimal tie on the even digit, as Rust formats it", () => {
    expect(valueLabel(0.25)).toBe("0.2");
  });
});

describe("tickLabel", () => {
  it("drops the precision the magnitude does not deserve", () => {
    expect(tickLabel(0)).toBe("0");
    expect(tickLabel(4.5)).toBe("4.5");
    expect(tickLabel(12.5)).toBe("12");
    expect(tickLabel(500)).toBe("500");
    expect(tickLabel(317.4)).toBe("317");
  });
});

describe("plotGeometry", () => {
  it("maps zero to the baseline and the axis max to the top", () => {
    const plot = plotGeometry(SAMPLE);

    near(plot.y(0, 5), plot.baseline);
    near(plot.y(5, 5), PAD_T);
  });

  it("clamps a value that overshoots its axis into the frame", () => {
    const plot = plotGeometry(SAMPLE);

    near(plot.y(50, 5), PAD_T);
    near(plot.y(-10, 5), plot.baseline);
  });

  it("stays on the baseline rather than dividing by a zero axis", () => {
    near(plotGeometry(SAMPLE).y(3, 0), plotGeometry(SAMPLE).baseline);
  });

  it("widens the right padding to make room for a second axis's labels", () => {
    const single = { ...SAMPLE, axes: [{ unit: "books" as const, max: 5 }] };

    expect(plotGeometry(single).padR).toBe(PAD_R_SINGLE);
    expect(plotGeometry(SAMPLE).padR).toBe(PAD_R_DUAL);
  });

  it("spaces the band centres evenly across the plot area", () => {
    const plot = plotGeometry(SAMPLE);

    near(plot.bandCentre(1) - plot.bandCentre(0), plot.bandW);
    expect(plot.bandCentre(0)).toBeGreaterThan(PAD_L);
    expect(plot.bandCentre(2)).toBeLessThan(VIEW_W - plot.padR);
  });
});

describe("axisMax", () => {
  it("falls back to the left axis when a series names a missing one", () => {
    const result = { ...SAMPLE, axes: SAMPLE.axes.slice(0, 1) };

    // The second series still claims axis 1, which no longer exists.
    expect(axisMax(result, series("avg_page_length", [], { axis: 1 }))).toBe(5);
  });
});

describe("lineRuns", () => {
  const lineOf = (values: (number | null)[]) => {
    const buckets = values.map((_, i) => `b${i}`);
    return lineRuns(
      plotGeometry({ ...SAMPLE, buckets }),
      series("avg_page_length", values, { mark: "line" }),
      5,
    );
  };

  it("breaks the line at a bucket with no data", () => {
    // Two points then a gap make one run, since the lone trailing point is not a second (a segment needs two ends).
    const runs = lineOf([1, 2, null, 3]);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.path.startsWith("M")).toBe(true);
  });

  it("returns nothing for a series that never has two adjacent points", () => {
    expect(lineOf([1, null, 3])).toEqual([]);
  });

  it("joins a fully populated series into one curved segment closed to the baseline", () => {
    const runs = lineOf([1, 2, 3]);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.path).toContain(" C");
    expect(runs[0]?.area.endsWith("Z")).toBe(true);
  });
});

describe("monotonePath", () => {
  it("is empty below two points and straight at two", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 0, y: 0 }])).toBe("");
    expect(
      monotonePath([
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ]),
    ).toBe("M0.0,10.0 L10.0,0.0");
  });

  it("never overshoots the values it passes through", () => {
    // A cardinal spline would bulge past y=0 on the way back up a spike; monotone tangents go flat at the extremum.
    const d = monotonePath([
      { x: 0, y: 100 },
      { x: 10, y: 100 },
      { x: 20, y: 0 },
      { x: 30, y: 100 },
      { x: 40, y: 100 },
    ]);
    const ys = d
      .split(/[ MC]/)
      .filter((t) => t.includes(","))
      .map((t) => Number(t.split(",")[1]));

    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(-0.01);
      expect(y).toBeLessThanOrEqual(100.01);
    }
  });

  it("stays flat through a flat run", () => {
    const d = monotonePath([
      { x: 0, y: 50 },
      { x: 10, y: 50 },
      { x: 20, y: 50 },
    ]);

    expect(d).not.toContain("49.");
    expect(d).not.toContain("51.");
  });
});

describe("stackOffsets", () => {
  it("puts each series on the running total beneath it", () => {
    const result = {
      ...SAMPLE,
      stacked: true,
      series: [
        series("books_finished", [2, 1, 0, 3], { slice: "Fantasy" }),
        series("books_finished", [1, 2, 1, null], { slice: "Horror" }),
      ],
    };

    const offsets = stackOffsets(result, [0, 1]);

    expect(offsets[0]).toEqual([0, 0, 0, 0]);
    // An absent value in the series below contributes nothing rather than leaving a hole.
    expect(offsets[1]).toEqual([2, 1, 0, 3]);
  });
});
