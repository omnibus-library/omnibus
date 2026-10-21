import { describe, expect, it } from "vitest";
import type { ChartResult } from "../../api";
import { apply, brushRange, resolve } from "./zoom";

const key = (m: number) => `2026-${String(m).padStart(2, "0")}`;
const months = (n: number) => Array.from({ length: n }, (_, i) => key(i + 1));

const result = (
  values: (number | null)[],
  overrides: Partial<ChartResult> = {},
): ChartResult => ({
  bucket: "month",
  buckets: months(values.length),
  series: [
    { measure: "books_finished", slice: null, axis: 0, mark: "bar", values },
  ],
  axes: [{ unit: "books", max: 100 }],
  divisions: 4,
  stacked: false,
  truncated: false,
  caveats: [],
  ...overrides,
});

describe("resolve", () => {
  it("finds an inclusive index span", () => {
    expect(resolve(months(8), [key(2), key(5)])).toEqual([1, 4]);
  });

  it("orders a backwards drag", () => {
    expect(resolve(months(8), [key(5), key(2)])).toEqual([1, 4]);
  });

  it("drops a zoom whose keys have left the axis", () => {
    // Regrouping monthly to weekly replaces every key; an index-based zoom would frame a different stretch.
    expect(resolve(["2026-03-02", "2026-03-09"], [key(2), key(5)])).toBeNull();
    // One end surviving is not enough either.
    expect(resolve(months(3), [key(2), key(9)])).toBeNull();
  });

  it("refuses a single bucket span", () => {
    expect(resolve(months(8), [key(3), key(3)])).toBeNull();
  });
});

describe("apply", () => {
  it("narrows the buckets and every series together", () => {
    const zoomed = apply(result([1, 2, 3, 4, 5, 6, 7, 8]), [key(3), key(5)]);

    expect(zoomed.buckets).toEqual([key(3), key(4), key(5)]);
    expect(zoomed.series[0]?.values).toEqual([3, 4, 5]);
  });

  it("refits the axis to what is on screen", () => {
    // A quiet stretch inside a tall range sits flat on the floor until the axis is refitted.
    const tall = result([2, 2, 2, 2, 2, 2, 2, 400], {
      axes: [{ unit: "books", max: 400 }],
    });

    const zoomed = apply(tall, [key(1), key(4)]);

    expect(zoomed.axes[0]?.max).toBeLessThan(20);
  });

  it("returns the whole result when the range does not resolve", () => {
    const whole = result([1, 2, 3]);

    // A stale zoom degrades to the full view rather than to an error.
    expect(apply(whole, ["nope", "also-nope"]).buckets).toEqual(whole.buckets);
    expect(apply(whole, null).buckets).toEqual(whole.buckets);
  });

  it("keeps the truncation flag, since it describes the fetch", () => {
    const clipped = result([1, 2, 3], { truncated: true });

    expect(apply(clipped, [key(1), key(2)]).truncated).toBe(true);
  });
});

describe("brushRange", () => {
  it("needs more than one bucket", () => {
    // A click, not a drag.
    expect(brushRange(months(8), 3, 3)).toBeNull();
    expect(brushRange(months(8), 3, 4)).toEqual([key(4), key(5)]);
  });

  it("normalises a right-to-left drag", () => {
    expect(brushRange(months(8), 5, 1)).toEqual([key(2), key(6)]);
  });

  it("is none when an index is off the axis", () => {
    expect(brushRange(months(3), 1, 9)).toBeNull();
  });
});
