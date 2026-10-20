import { describe, expect, it } from "vitest";
import { dayNumber } from "./calendar";
import { buildSpark, SPARK_DAYS, streakLine } from "./hero";

function spark(asOf: string, streak: number, days: [string, number][]) {
  const anchor = dayNumber(asOf);
  if (anchor === null) throw new Error(`no such day: ${asOf}`);
  return buildSpark(
    {
      current_streak_days: streak,
      heatmap: days.map(([day, seconds]) => ({ day, seconds })),
    },
    anchor,
  );
}

describe("buildSpark", () => {
  it("draws one slot per day and scales to its own busiest", () => {
    const bars = spark("2026-08-12", 2, [
      ["2026-08-12", 1800],
      ["2026-08-11", 3600],
      ["2026-08-01", 900],
    ]);

    expect(bars).toHaveLength(SPARK_DAYS);
    expect(bars.at(-1)).toMatchObject({ day: "2026-08-12", heightPct: 50 });
    // The quiet days keep their slots, since the gaps are what make a run visible.
    expect(bars.filter((b) => !b.active).length).toBeGreaterThan(30);
  });

  it("marks only the live run, and only where something happened", () => {
    const bars = spark("2026-08-12", 2, [
      ["2026-08-12", 600],
      ["2026-08-11", 600],
      ["2026-08-05", 600],
    ]);

    expect(bars.filter((b) => b.inStreak).map((b) => b.day)).toEqual([
      "2026-08-11",
      "2026-08-12",
    ]);
    // The earlier active day is drawn, but not as part of the run.
    expect(bars.find((b) => b.day === "2026-08-05")).toMatchObject({
      active: true,
      inStreak: false,
    });
  });

  it("stays flat when nothing was recorded", () => {
    const bars = spark("2026-08-12", 0, []);

    expect(bars.every((b) => b.heightPct === 0 && !b.active)).toBe(true);
  });
});

describe("streakLine", () => {
  it("compares the run against the record, and says nothing without one", () => {
    expect(streakLine(3, 61, true)).toBe("Your longest ever is 61 days.");
    expect(streakLine(0, 1, true)).toBe("Your longest ever is 1 day.");
    expect(streakLine(61, 61, true)).toBe(
      "That is the longest run you have recorded.",
    );
    // With nothing recorded yet the sentence would say nothing.
    expect(streakLine(0, 0, true)).toBeNull();
  });

  it("reads third person on another reader's page", () => {
    expect(streakLine(3, 61, false)).toBe("The longest ever is 61 days.");
    expect(streakLine(61, 61, false)).toBe(
      "That is the longest run on record.",
    );
  });
});
