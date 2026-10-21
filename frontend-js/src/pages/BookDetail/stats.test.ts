import { describe, expect, it } from "vitest";
import type { Insights } from "../../api";
import {
  avgSitSeconds,
  daysIn,
  SPARK_DAYS,
  sparkBuckets,
  sparkSummary,
  timeLeftNote,
} from "./stats";

const insights = (overrides: Partial<Insights> = {}): Insights => ({
  startedAt: 0,
  secondsTotal: 3600,
  sessions: 3,
  sittingSeconds: 3000,
  longestSeconds: 1800,
  longestStartedAt: 0,
  daily: [],
  asOfDay: "2026-08-24",
  ...overrides,
});

describe("daysIn", () => {
  it("reads today within the first day", () => {
    expect(daysIn(86_399, 0)).toBe("today");
  });

  it("counts elapsed days", () => {
    expect(daysIn(86_400, 0)).toBe("1 day in");
    expect(daysIn(3 * 86_400 + 5, 0)).toBe("3 days in");
  });

  it("never goes negative for a start in the future", () => {
    expect(daysIn(0, 500)).toBe("today");
  });
});

describe("avgSitSeconds", () => {
  it("divides the counted sittings, not the total with its glances", () => {
    expect(avgSitSeconds(insights({ sittingSeconds: 3000, sessions: 3 }))).toBe(
      1000,
    );
  });
});

describe("timeLeftNote", () => {
  it("extrapolates the pace so far", () => {
    expect(timeLeftNote(insights({ secondsTotal: 3600 }), 40)).toBe(
      "≈ 1h 30m to go at your pace · 40% in",
    );
  });

  it("makes no estimate below five percent", () => {
    expect(timeLeftNote(insights(), 4)).toBeNull();
    expect(timeLeftNote(insights(), 5)).not.toBeNull();
  });

  it("says the record is complete once finished", () => {
    expect(timeLeftNote(insights(), 100)).toBe(
      "finished — the record is complete",
    );
    expect(timeLeftNote(insights(), 140)).toBe(
      "finished — the record is complete",
    );
  });
});

describe("sparkBuckets", () => {
  it("places minutes by day and zero-fills the gaps", () => {
    const out = sparkBuckets(
      [
        { day: "2026-08-24", seconds: 600 },
        { day: "2026-08-03", seconds: 120 },
        // Outside the window.
        { day: "2026-07-01", seconds: 999 },
      ],
      "2026-08-24",
    );
    expect(out).toHaveLength(SPARK_DAYS);
    expect(out[SPARK_DAYS - 1]).toBe(10);
    // Aug 3 is exactly 21 days before Aug 24.
    expect(out[0]).toBe(2);
    expect(out.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it("is all zeros when the anchor day is not a date", () => {
    expect(
      sparkBuckets([{ day: "2026-08-24", seconds: 600 }], "later"),
    ).toEqual(new Array(SPARK_DAYS).fill(0));
    expect(
      sparkBuckets([{ day: "2026-08-24", seconds: 600 }], "2026-02-31"),
    ).toEqual(new Array(SPARK_DAYS).fill(0));
  });

  it("ignores a malformed day", () => {
    expect(
      sparkBuckets([{ day: "yesterday", seconds: 600 }], "2026-08-24").some(
        (v) => v > 0,
      ),
    ).toBe(false);
  });
});

describe("sparkSummary", () => {
  const spark = (...minutes: [number, number][]) => {
    const out = new Array<number>(SPARK_DAYS).fill(0);
    for (const [at, v] of minutes) out[at] = v;
    return out;
  };

  it("says none when nothing was read", () => {
    expect(sparkSummary(spark(), "2026-08-24", false)).toBe(
      "Minutes read per day over the last 22 days: none.",
    );
  });

  it("names the total, the active days and the peak day", () => {
    expect(sparkSummary(spark([0, 2], [21, 10]), "2026-08-24", false)).toBe(
      "Minutes read per day over the last 22 days: 12 minutes across 2 days, most on Aug 24 with 10 minutes.",
    );
  });

  it("breaks a tie to the earliest day", () => {
    expect(sparkSummary(spark([0, 5], [21, 5]), "2026-08-24", false)).toContain(
      "most on Aug 3 with 5 minutes",
    );
  });

  it("says listened for an audio-only book", () => {
    expect(sparkSummary(spark([21, 1]), "2026-08-24", true)).toBe(
      "Minutes listened per day over the last 22 days: 1 minute across 1 day, most on Aug 24 with 1 minute.",
    );
  });
});
