import { describe, expect, it } from "vitest";
import type {
  ChartAxis,
  ChartMeasure,
  ChartResult,
  ChartSeries,
  ChartUnit,
} from "../../api";
import {
  availabilityNote,
  emptyNote,
  joinUnits,
  scalesNote,
  splitNote,
  zoomNote,
} from "./notes";

const series = (
  measure: ChartMeasure,
  axis: number,
  slice: string | null = null,
): ChartSeries => ({ measure, slice, axis, mark: "bar", values: [1, 2] });

const axis = (unit: ChartUnit): ChartAxis => ({ unit, max: 10 });

const result = (
  seriesList: ChartSeries[],
  axes: ChartAxis[],
  overrides: Partial<ChartResult> = {},
): ChartResult => ({
  bucket: "month",
  buckets: ["2026-01", "2026-02"],
  series: seriesList,
  axes,
  divisions: 4,
  stacked: false,
  truncated: false,
  caveats: [],
  ...overrides,
});

/** The default chart: a count against an average, on two scales. */
const TWO_SCALES = result(
  [series("books_finished", 0), series("avg_page_length", 1)],
  [axis("books"), axis("pages")],
);

const ONE_SCALE = result(
  [series("reading_minutes", 0), series("listening_minutes", 0)],
  [axis("minutes")],
);

describe("joinUnits", () => {
  it("reads as a list a person would write", () => {
    expect(joinUnits([])).toBe("");
    expect(joinUnits(["books"])).toBe("books");
    expect(joinUnits(["books", "pages"])).toBe("books and pages");
    expect(joinUnits(["books", "pages", "minutes"])).toBe(
      "books, pages and minutes",
    );
  });
});

describe("scalesNote", () => {
  it("warns that a crossing means nothing on two axes", () => {
    const note = scalesNote(TWO_SCALES);

    expect(note).toContain("books on the left");
    expect(note).toContain("pages on the right");
    expect(note).toContain("means nothing");
  });

  it("says one scale is directly comparable, with no crossing warning", () => {
    const note = scalesNote(ONE_SCALE);

    expect(note).toContain("minutes");
    expect(note).toContain("directly comparable");
    expect(note).not.toContain("means nothing");
  });

  it("is absent when there is nothing to scale", () => {
    expect(scalesNote(result([], []))).toBeNull();
  });
});

describe("availabilityNote", () => {
  it("names the units holding the scales and what would free one", () => {
    const note = availabilityNote(TWO_SCALES);

    expect(note).toContain("books and pages");
    expect(note).toContain("greyed out");
    expect(note).toContain("free a scale");
  });

  it("says so while a scale is free", () => {
    const note = availabilityNote(ONE_SCALE);

    expect(note).toContain("still free");
    expect(note).not.toContain("greyed out");
  });
});

describe("splitNote", () => {
  const split = (measure: ChartMeasure, slices: string[], stacked: boolean) =>
    result(
      slices.map((slice) => series(measure, 0, slice)),
      [axis("books")],
      { stacked },
    );

  it("explains stacking only when the split stacks", () => {
    expect(
      splitNote(split("books_finished", ["Fantasy", "Horror"], true)),
    ).toContain("slices stack");
    expect(
      splitNote(split("avg_page_length", ["Fantasy", "Horror"], false)),
    ).toContain("averages don't add up");
  });

  it("mentions the fold only when something was folded", () => {
    expect(
      splitNote(split("books_finished", ["Fantasy", "Other"], true)),
    ).toContain("folded into Other");
    expect(splitNote(split("books_finished", ["Fantasy"], true))).not.toContain(
      "folded into Other",
    );
  });

  it("is absent without a split", () => {
    expect(splitNote(TWO_SCALES)).toBeNull();
  });
});

describe("emptyNote", () => {
  it("tells a zero total from an absent average", () => {
    // Both kinds on screen, so the sentence has to cover both.
    const both = emptyNote(TWO_SCALES);
    expect(both).toContain("zero for the totals");
    expect(both).toContain("can't average nothing");

    const averages = emptyNote(
      result([series("avg_rating", 0)], [axis("stars")]),
    );
    expect(averages).toContain("line breaks");
  });

  it("has nothing to explain when only totals are on screen", () => {
    expect(
      emptyNote(result([series("books_finished", 0)], [axis("books")])),
    ).toBeNull();
  });
});

describe("zoomNote", () => {
  it("says it only narrows what was already fetched", () => {
    const note = zoomNote(TWO_SCALES);

    expect(note).toContain("Drag across the chart");
    expect(note).toContain("not");
    expect(note).toContain("Group by");
  });

  it("adds the clipped range when the axis was truncated", () => {
    expect(zoomNote({ ...TWO_SCALES, truncated: true })).toContain("clip");
  });
});
