import { describe, expect, it } from "vitest";
import type {
  ChartBreakdown,
  ChartMeasure,
  ChartResult,
  ChartSeries,
  ChartSpec,
} from "../../api";
import {
  axisFor,
  axisMaxOn,
  canAdd,
  DEFAULT_SPEC,
  fitAxes,
  MEASURES,
  niceAxis,
  niceStep,
  resultIsEmpty,
  seriesLabel,
  seriesMax,
  specUnits,
  supportsBreakdown,
  toggle,
} from "./chart";

const ALL: ChartMeasure[] = [
  "books_finished",
  "avg_page_length",
  "avg_rating",
  "reading_minutes",
  "listening_minutes",
  "session_count",
  "avg_session_minutes",
  "pages_read",
];

const spec = (
  measures: ChartMeasure[],
  breakdown: ChartBreakdown = "none",
): ChartSpec => ({ measures, bucket: "month", range: "year", breakdown });

const series = (
  measure: ChartMeasure,
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

describe("MEASURES", () => {
  it.each(ALL)("says what %s counts in a sentence of its own", (measure) => {
    const { description, label } = MEASURES[measure];

    expect(description.endsWith(".")).toBe(true);
    expect(description.replace(/\.$/, "")).not.toBe(label);
  });
});

describe("specUnits", () => {
  it("orders units by when each first claimed an axis", () => {
    expect(
      specUnits(spec(["avg_page_length", "books_finished", "pages_read"])),
    ).toEqual(["pages", "books"]);
  });
});

describe("axisFor", () => {
  it("puts a shared unit on the axis it already claimed", () => {
    const s = spec(["books_finished", "avg_page_length"]);

    expect(axisFor(s, "books_finished")).toBe(0);
    expect(axisFor(s, "pages_read")).toBe(1);
    expect(axisFor(s, "avg_rating")).toBeNull();
  });

  it("hands a new unit the free axis while one remains", () => {
    const s = spec(["books_finished"]);

    expect(axisFor(s, "avg_rating")).toBe(1);
    expect(axisFor(s, "session_count")).toBe(1);
  });
});

describe("canAdd", () => {
  it("narrows the list only once both scales are claimed", () => {
    const one = spec(["books_finished"]);
    for (const m of ALL) expect(canAdd(one, m)).toBe(m !== "books_finished");

    const two = spec(["books_finished", "avg_page_length"]);
    expect(canAdd(two, "pages_read")).toBe(true);
    expect(canAdd(two, "avg_rating")).toBe(false);
    expect(canAdd(two, "reading_minutes")).toBe(false);
    expect(canAdd(two, "books_finished")).toBe(false);
  });
});

describe("toggle", () => {
  it("adds, removes and keeps the order the measures were chosen in", () => {
    let s = spec(["books_finished"]);
    s = toggle(toggle(s, "avg_page_length"), "pages_read");
    expect(s.measures).toEqual([
      "books_finished",
      "avg_page_length",
      "pages_read",
    ]);

    s = toggle(s, "avg_page_length");
    expect(s.measures).toEqual(["books_finished", "pages_read"]);

    // A third unit is a no-op, since the control offering it is already disabled.
    expect(toggle(s, "avg_rating").measures).toEqual(s.measures);
  });

  it("frees a scale for another unit when its measure comes off", () => {
    const s = spec(["books_finished", "avg_page_length"]);
    expect(canAdd(s, "avg_rating")).toBe(false);

    expect(canAdd(toggle(s, "avg_page_length"), "avg_rating")).toBe(true);
  });

  it.each([
    ["a second measure joins", spec(["books_finished"], "genre"), "avg_rating"],
    [
      "the one measure comes off",
      spec(["books_finished"], "genre"),
      "books_finished",
    ],
    [
      "a measure that cannot split is picked",
      spec([], "genre"),
      "reading_minutes",
    ],
  ] as const)("drops the split when %s", (_case, before, measure) => {
    expect(toggle(before, measure).breakdown).toBe("none");
  });

  it("keeps the split while its one splittable measure remains", () => {
    expect(toggle(spec([], "genre"), "books_finished").breakdown).toBe("genre");
  });
});

describe("supportsBreakdown", () => {
  it("is true only for the measures counted per book finished", () => {
    expect(ALL.filter(supportsBreakdown)).toEqual([
      "books_finished",
      "avg_page_length",
    ]);
  });
});

describe("seriesLabel", () => {
  it("qualifies the measure with its slice when split", () => {
    expect(seriesLabel(series("books_finished", []))).toBe("Books finished");
    expect(
      seriesLabel(series("books_finished", [], { slice: "Fantasy" })),
    ).toBe("Books finished · Fantasy");
  });
});

describe("seriesMax", () => {
  it("ignores absent buckets, and is none when every one is absent", () => {
    expect(seriesMax(series("avg_page_length", [null, 320, null, 180]))).toBe(
      320,
    );
    expect(seriesMax(series("avg_page_length", [null, null]))).toBeNull();
  });
});

describe("resultIsEmpty", () => {
  const result = (overrides: Partial<ChartResult>): ChartResult => ({
    bucket: "month",
    buckets: ["2026-01", "2026-02"],
    series: [series("avg_rating", [null, null], { mark: "line" })],
    axes: [{ unit: "stars", max: 1 }],
    divisions: 4,
    stacked: false,
    truncated: false,
    caveats: [],
    ...overrides,
  });

  it("is true when no bucket carries a value", () => {
    expect(resultIsEmpty(result({}))).toBe(true);
    expect(
      resultIsEmpty(result({ series: [series("avg_rating", [null, 4])] })),
    ).toBe(false);
  });

  it("is true with no buckets even when a series exists", () => {
    expect(
      resultIsEmpty(
        result({ buckets: [], series: [series("books_finished", [])] }),
      ),
    ).toBe(true);
  });
});

describe("DEFAULT_SPEC", () => {
  it("plots nothing, and leaves every measure available", () => {
    expect(DEFAULT_SPEC).toEqual({
      measures: [],
      bucket: "month",
      range: "year",
      breakdown: "none",
    });
    for (const m of ALL) expect(canAdd(DEFAULT_SPEC, m)).toBe(true);
  });
});

describe("niceStep", () => {
  it("rounds up to a readable tick", () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.2)).toBe(2);
    expect(niceStep(2.4)).toBe(2.5);
    expect(niceStep(137.5)).toBe(200);
  });
});

describe("niceAxis", () => {
  it("keeps the data filling most of the frame", () => {
    // A peak of 550 once took a 1000 axis and drew every shape at half height.
    expect(niceAxis(550, false)).toEqual({ max: 600, divisions: 3 });
    // Stars top out at 5, so a 4.5 peak must not open an axis past it.
    expect(niceAxis(4.5, false)).toEqual({ max: 5, divisions: 5 });
  });

  it("gives a small count one gridline per whole unit", () => {
    expect(niceAxis(6, true)).toEqual({ max: 6, divisions: 6 });
    expect(niceAxis(2, true)).toEqual({ max: 2, divisions: 2 });
    expect(niceAxis(1, true)).toEqual({ max: 1, divisions: 1 });
    expect(niceAxis(2, false)).toEqual({ max: 2, divisions: 4 });
  });

  it("keeps a large count on whole-number steps", () => {
    const { max, divisions } = niceAxis(38, true);

    expect({ max, divisions }).toEqual({ max: 40, divisions: 4 });
    expect(max % divisions).toBe(0);
  });

  it.each([0.3, 1, 6, 47, 317, 550, 999, 1_000_000])(
    "never returns a max under a peak of %s",
    (peak) => {
      expect(niceAxis(peak, false).max).toBeGreaterThanOrEqual(peak);
      expect(niceAxis(peak, true).max).toBeGreaterThanOrEqual(peak);
    },
  );

  it("never returns zero, so the renderer cannot divide by it", () => {
    expect(niceAxis(0, false).max).toBe(1);
    expect(niceAxis(-5, false).max).toBe(1);
    expect(niceAxis(Number.NaN, false).max).toBe(1);
    expect(niceAxis(0, true).max).toBe(1);
    expect(axisMaxOn(0, 4, false)).toBe(1);
  });
});

describe("axisMaxOn", () => {
  it("fits the right axis to the gridline count the left chose", () => {
    expect(axisMaxOn(450, 5, false)).toBe(500);
  });
});

describe("fitAxes", () => {
  it("scales a stacked axis to the tallest column, not the tallest slice", () => {
    const slices = ["Fantasy", "Horror", "Crime"].map((name) =>
      series("books_finished", [2, 1], { slice: name }),
    );

    expect(fitAxes(slices, true, 2).axes[0]?.max).toBeGreaterThanOrEqual(6);
    expect(fitAxes(slices, false, 2).axes[0]?.max).toBe(2);
  });

  it("gives a second unit its own axis on the shared gridline count", () => {
    const { axes, divisions } = fitAxes(
      [
        series("books_finished", [4]),
        series("avg_page_length", [450], { axis: 1, mark: "line" }),
      ],
      false,
      1,
    );

    expect(axes.map((a) => a.unit)).toEqual(["books", "pages"]);
    expect(axes[1]?.max).toBeGreaterThanOrEqual(450);
    expect(divisions).toBeGreaterThanOrEqual(3);
  });
});
