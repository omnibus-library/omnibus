import { describe, expect, it } from "vitest";
import type { HouseholdActivity, Insights } from "../../api";
import {
  finishTotals,
  householdLine,
  lastActivityLabel,
  pacedLeft,
  paceLabel,
  readingStatusLine,
  SPARK_DAYS,
  spanDays,
  sparkBuckets,
  sparkSummary,
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

describe("paceLabel", () => {
  const hour = insights({ secondsTotal: 3600 });

  it("gives pages an hour when the page count is known", () => {
    // 40% of 300 pages is 120 pages, in the one hour spent.
    expect(paceLabel({ insights: hour, percent: 40, pages: 300 })).toBe(
      "About 120 pages an hour",
    );
  });

  it("falls back to percent an hour", () => {
    expect(paceLabel({ insights: hour, percent: 40, pages: null })).toBe(
      "About 40% an hour",
    );
  });

  it("says nothing below five percent", () => {
    expect(paceLabel({ insights: hour, percent: 4, pages: 300 })).toBeNull();
    expect(
      paceLabel({ insights: hour, percent: 5, pages: 300 }),
    ).not.toBeNull();
  });

  it("says nothing without any time spent", () => {
    expect(
      paceLabel({
        insights: insights({ secondsTotal: 0 }),
        percent: 40,
        pages: 300,
      }),
    ).toBeNull();
  });
});

describe("householdLine", () => {
  const maya: HouseholdActivity = {
    reader: {
      id: 2 as HouseholdActivity["reader"]["id"],
      name: "Maya",
      hasAvatar: false,
    },
    seconds: 9_960,
    sessions: 3,
    lastSessionAt: 0,
  };

  it("says listened for an audiobook only book", () => {
    expect(householdLine(maya, true)).toBe("Listened 2 h 46 m over 3 sessions");
  });

  it("says read otherwise", () => {
    expect(householdLine(maya, false)).toBe("Read 2 h 46 m over 3 sessions");
  });

  it("says one session for a single sitting", () => {
    expect(householdLine({ ...maya, sessions: 1 }, false)).toBe(
      "Read 2 h 46 m over 1 session",
    );
  });
});

describe("lastActivityLabel", () => {
  // Local clock times, so the day and the hour read the same in every zone.
  const at = (month: number, day: number, hour: number, minute = 0) =>
    new Date(2026, month - 1, day, hour, minute).getTime() / 1000;
  const now = at(10, 20, 9);

  it("says today and the time", () => {
    expect(lastActivityLabel(now, at(10, 20, 7, 5))).toBe("Today at 07:05");
  });

  it("says yesterday and the time", () => {
    expect(lastActivityLabel(now, at(10, 19, 22, 40))).toBe(
      "Yesterday at 22:40",
    );
  });

  it("names an earlier day this year", () => {
    expect(lastActivityLabel(now, at(10, 12, 14, 30))).toBe(
      "October 12 at 14:30",
    );
  });

  it("adds the year to a day in another year", () => {
    expect(
      lastActivityLabel(now, new Date(2025, 11, 31, 23, 59).getTime() / 1000),
    ).toBe("December 31, 2025 at 23:59");
  });
});

describe("pacedLeft", () => {
  it("extrapolates the pace so far", () => {
    expect(pacedLeft(insights({ secondsTotal: 3600 }), 40)).toBe(5400);
  });

  it("makes no estimate below five percent", () => {
    expect(pacedLeft(insights(), 4)).toBeNull();
    expect(pacedLeft(insights(), 5)).not.toBeNull();
  });

  it("makes no estimate once the book is done", () => {
    expect(pacedLeft(insights(), 100)).toBeNull();
  });
});

describe("spanDays", () => {
  const noon = (month: number, day: number) =>
    new Date(2026, month - 1, day, 12).getTime() / 1000;

  it("counts both the first and the last day", () => {
    expect(spanDays(noon(10, 2), noon(10, 18))).toBe(17);
  });

  it("is one day for a start and finish on the same day", () => {
    expect(spanDays(noon(10, 2), noon(10, 2) + 3600)).toBe(1);
  });
});

describe("finishTotals", () => {
  // Local noon, so the calendar day reads the same in every zone.
  const noon = (month: number, day: number) =>
    new Date(2026, month - 1, day, 12).getTime() / 1000;

  it("counts days sessions and highlights", () => {
    expect(
      finishTotals({
        startedAt: noon(10, 2),
        finishedAt: noon(10, 18),
        sessions: 13,
        highlights: 2,
      }),
    ).toBe("17 days · 13 sessions · 2 highlights");
  });

  it("says one day for a book finished the day it started", () => {
    expect(
      finishTotals({
        startedAt: noon(10, 2),
        finishedAt: noon(10, 2) + 3600,
        sessions: 1,
        highlights: 1,
      }),
    ).toBe("1 day · 1 session · 1 highlight");
  });

  it("leaves out highlights when there are none", () => {
    expect(
      finishTotals({
        startedAt: noon(10, 2),
        finishedAt: noon(10, 3),
        sessions: 4,
        highlights: 0,
      }),
    ).toBe("2 days · 4 sessions");
  });

  it("never counts a finish before the start as less than a day", () => {
    expect(
      finishTotals({
        startedAt: noon(10, 5),
        finishedAt: noon(10, 2),
        sessions: 2,
        highlights: 0,
      }),
    ).toBe("1 day · 2 sessions");
  });
});

describe("sparkBuckets", () => {
  it("places minutes by day and zero-fills the gaps", () => {
    const out = sparkBuckets(
      [
        { day: "2026-08-24", seconds: 600 },
        { day: "2026-08-11", seconds: 120 },
        // Outside the window.
        { day: "2026-07-01", seconds: 999 },
      ],
      "2026-08-24",
    );
    expect(out).toHaveLength(SPARK_DAYS);
    expect(out[SPARK_DAYS - 1]).toBe(10);
    // Aug 11 is exactly 13 days before Aug 24: the first of the fourteen.
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
      "Minutes read per day over the last 14 days: none.",
    );
  });

  it("names the total, the active days and the peak day", () => {
    expect(sparkSummary(spark([0, 2], [13, 10]), "2026-08-24", false)).toBe(
      "Minutes read per day over the last 14 days: 12 minutes across 2 days, most on Aug 24 with 10 minutes.",
    );
  });

  it("breaks a tie to the earliest day", () => {
    expect(sparkSummary(spark([0, 5], [13, 5]), "2026-08-24", false)).toContain(
      "most on Aug 11 with 5 minutes",
    );
  });

  it("says listened for an audio-only book", () => {
    expect(sparkSummary(spark([13, 1]), "2026-08-24", true)).toBe(
      "Minutes listened per day over the last 14 days: 1 minute across 1 day, most on Aug 24 with 1 minute.",
    );
  });
});

describe("readingStatusLine", () => {
  const noon = (month: number, day: number) =>
    new Date(2026, month - 1, day, 12).getTime() / 1000;
  const line = (
    status: Parameters<typeof readingStatusLine>[0]["status"],
    startedAt: number | null = null,
    finishedAt: number | null = null,
    audioOnly = false,
  ) => readingStatusLine({ status, startedAt, finishedAt, audioOnly });

  it("says nothing while the status is unknown", () => {
    expect(line(undefined, noon(10, 2))).toBeNull();
  });

  it("says when a finished book was started, finished, and after how long", () => {
    expect(line("finished", noon(10, 2), noon(10, 18))).toBe(
      "Finished October 18, 2026 at 12:00, after 17 days",
    );
  });

  it("counts a single day as one", () => {
    expect(line("finished", noon(10, 18), noon(10, 18))).toBe(
      "Finished October 18, 2026 at 12:00, after 1 day",
    );
  });

  it("says when a finished book with no sittings was finished", () => {
    expect(line("finished", null, noon(10, 18))).toBe(
      "Finished October 18, 2026",
    );
  });

  it("says finished for a book with no date", () => {
    expect(line("finished")).toBe("Finished");
  });

  it("says since when the sittings began", () => {
    expect(line("reading", noon(10, 2))).toBe("Reading since October 2, 2026");
    expect(line("reading", noon(10, 2), null, true)).toBe(
      "Listening since October 2, 2026",
    );
  });

  it("says reading or listening with no sittings yet", () => {
    expect(line("reading")).toBe("Reading");
    expect(line("reading", null, null, true)).toBe("Listening");
  });

  it("says not started only for an unread book with no sittings", () => {
    expect(line("unread")).toBe("Not started yet");
  });
});
