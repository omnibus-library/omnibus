import { describe, expect, it } from "vitest";
import {
  averageLabel,
  buildBars,
  monthInitial,
  monthlyAverage,
} from "./monthly";

const month = (m: string, books: number) => ({ month: m, books });

describe("monthInitial", () => {
  it("maps month numbers and falls back on garbage", () => {
    expect(monthInitial("2026-01")).toBe("J");
    expect(monthInitial("2026-07")).toBe("J");
    expect(monthInitial("2026-12")).toBe("D");
    expect(monthInitial("not-a-month")).toBe("?");
    expect(monthInitial("2026-13")).toBe("?");
  });
});

describe("buildBars", () => {
  it("scales to the tallest month and flags the last as current", () => {
    const bars = buildBars([
      month("2026-01", 0),
      month("2026-02", 2),
      month("2026-03", 4),
    ]);

    expect(bars.map((b) => b.heightPct)).toEqual([0, 50, 100]);
    expect(bars.map((b) => b.current)).toEqual([false, false, true]);
  });

  it("stays zero when every month is zero", () => {
    const bars = buildBars([month("2026-01", 0), month("2026-02", 0)]);

    expect(bars.every((b) => b.heightPct === 0)).toBe(true);
  });
});

describe("monthlyAverage", () => {
  it("means the window, and is none when empty", () => {
    expect(
      monthlyAverage([
        month("2026-01", 1),
        month("2026-02", 2),
        month("2026-03", 3),
      ]),
    ).toBe(2);
    expect(monthlyAverage([])).toBeNull();
  });
});

describe("averageLabel", () => {
  it("writes the average to one decimal", () => {
    expect(averageLabel([month("2026-01", 3), month("2026-02", 0)])).toBe(
      "avg 1.5 / month",
    );
  });

  // Three books over twelve months is exactly 0.25, which Rust's `{:.1}` rounds to 0.2 where toFixed gives 0.3.
  it("settles a half-way average on the even decimal, as Rust formats it", () => {
    const year = Array.from({ length: 12 }, (_, i) =>
      month(`2026-${String(i + 1).padStart(2, "0")}`, i < 3 ? 1 : 0),
    );

    expect(averageLabel(year)).toBe("avg 0.2 / month");
  });

  it("is empty without months", () => {
    expect(averageLabel([])).toBe("");
  });
});
