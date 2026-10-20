import { describe, expect, it } from "vitest";
import { dayNumber, streakSpan } from "./calendar";
import {
  buildCells,
  buildHeatmap,
  cellTitle,
  coverage,
  intensity,
  trailingMonthLabels,
  WEEKS,
} from "./heatmap";

const day = (n: number) =>
  dayNumber(`2026-07-${String(n).padStart(2, "0")}`) ?? 0;

describe("coverage", () => {
  // A year is not over, so dividing by 364 would report every December as a failure to read days that haven't happened.
  it("measures against the days elapsed, not the whole grid", () => {
    const byDay = new Map([1, 2, 3, 4, 5].map((n) => [day(n), 600]));

    expect(coverage(byDay, day(1), day(10))).toEqual({
      daysRead: 5,
      percent: 50,
    });
  });

  it("is zero of both for nothing recorded, never a divide by zero", () => {
    expect(coverage(new Map(), day(1), day(10))).toEqual({
      daysRead: 0,
      percent: 0,
    });
  });

  it("ignores days outside the drawn window", () => {
    const byDay = new Map([
      [day(1) - 40, 600],
      [day(3), 600],
    ]);

    expect(coverage(byDay, day(1), day(4))).toEqual({
      daysRead: 1,
      percent: 25,
    });
  });
});

describe("intensity", () => {
  it("reserves zero for a quiet day and caps at four", () => {
    expect(intensity(0, 100)).toBe(0);
    expect(intensity(50, 0)).toBe(0);
    expect(intensity(1, 100)).toBe(1);
    expect(intensity(100, 100)).toBe(4);
    expect(intensity(400, 100)).toBe(4);
  });

  it("steps up each quarter of the busiest day", () => {
    expect(
      [25, 26, 50, 51, 75, 76].map((secs) => intensity(secs, 100)),
    ).toEqual([1, 2, 2, 3, 3, 4]);
  });
});

describe("buildCells", () => {
  it("outlines only the live run, and only where something happened", () => {
    const byDay = new Map([
      [day(10), 600],
      [day(11), 600],
      [day(12), 600],
      [day(3), 600],
    ]);
    const streak = streakSpan(day(12), [day(10), day(11), day(12)], 3);

    const cells = buildCells(day(12), byDay, 600, streak);

    expect(cells.filter((c) => c.inStreak).map((c) => c.day)).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
    // The earlier active day is drawn, but not as part of the run.
    expect(cells.find((c) => c.day === "2026-07-03")).toMatchObject({
      secs: 600,
      inStreak: false,
    });
  });

  it("marks the days after the anchor as spacers", () => {
    // A Wednesday, so the final week runs past it.
    const cells = buildCells(day(8), new Map(), 0, null);

    expect(cells).toHaveLength(WEEKS * 7);
    expect(cells.some((c) => c.future)).toBe(true);
    expect(cells.filter((c) => c.future).every((c) => c.secs === 0)).toBe(true);
  });

  it("starts on a Monday and ends in the week containing the anchor", () => {
    const cells = buildCells(day(8), new Map(), 0, null);

    // 2026-07-08 is a Wednesday; 51 weeks before its Monday (2026-07-06) is 2025-07-14.
    expect(cells[0]?.day).toBe("2025-07-14");
    expect(cells.at(-1)?.day).toBe("2026-07-12");
  });
});

describe("trailingMonthLabels", () => {
  it("ends at the anchor's own month", () => {
    const labels = trailingMonthLabels(dayNumber("2026-08-14") ?? 0);

    expect(labels).toHaveLength(12);
    expect(labels[0]).toBe("Sep");
    expect(labels.at(-1)).toBe("Aug");
  });
});

describe("cellTitle", () => {
  it("names the time on a day that has some, and the bare day otherwise", () => {
    const base = { day: "2026-08-14" };

    expect(cellTitle({ ...base, secs: 12_000, future: false })).toBe(
      "3 h 20 m on 2026-08-14",
    );
    expect(cellTitle({ ...base, secs: 0, future: false })).toBe("2026-08-14");
    expect(cellTitle({ ...base, secs: 600, future: true })).toBe("2026-08-14");
  });
});

describe("buildHeatmap", () => {
  const bare = { as_of_day: "", heatmap: [], current_streak_days: 0 };

  // With no day to anchor on, the card reserves its space instead of drawing days it would have to invent.
  it("is absent without a server day or any activity", () => {
    expect(buildHeatmap(bare)).toBeNull();
  });

  it("anchors on the newest active day when the server sent none", () => {
    const heat = buildHeatmap({
      ...bare,
      heatmap: [
        { day: "2026-07-03", seconds: 600 },
        { day: "2026-07-09", seconds: 60 },
      ],
    });

    expect(heat?.cells.filter((c) => !c.future).at(-1)?.day).toBe("2026-07-09");
    expect(heat?.daysRead).toBe(2);
  });

  it("counts only the days inside the grid", () => {
    const heat = buildHeatmap({
      as_of_day: "2026-07-12",
      current_streak_days: 0,
      heatmap: [
        { day: "2024-01-01", seconds: 600 },
        { day: "2026-07-12", seconds: 600 },
      ],
    });

    expect(heat?.daysRead).toBe(1);
  });

  it("outlines the live run on the cells", () => {
    const heat = buildHeatmap({
      as_of_day: "2026-07-12",
      current_streak_days: 2,
      heatmap: [
        { day: "2026-07-11", seconds: 600 },
        { day: "2026-07-12", seconds: 600 },
      ],
    });

    expect(heat?.cells.filter((c) => c.inStreak).map((c) => c.day)).toEqual([
      "2026-07-11",
      "2026-07-12",
    ]);
  });
});
