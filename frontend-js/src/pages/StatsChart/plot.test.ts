import { describe, expect, it } from "vitest";
import { bucketLabel, bucketTitle, valueLabel } from "./plot";

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
