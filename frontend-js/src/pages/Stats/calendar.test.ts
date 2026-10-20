import { describe, expect, it } from "vitest";
import {
  civilFromDays,
  dayNumber,
  dayString,
  monthName,
  streakSpan,
  windowLabel,
  yearFraction,
} from "./calendar";

function day(n: number) {
  const parsed = dayNumber(`2026-07-${String(n).padStart(2, "0")}`);
  if (parsed === null) throw new Error(`no such day: ${n}`);
  return parsed;
}

describe("dayNumber", () => {
  it("counts days from the Unix epoch", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("2026-08-14")).toBe(20_679);
  });

  it("round-trips a civil date through civilFromDays and dayString", () => {
    const n = day(12);

    expect(civilFromDays(n)).toEqual([2026, 7, 12]);
    expect(dayString(n)).toBe("2026-07-12");
  });

  it("accepts the last day of December", () => {
    expect(dayNumber("2026-12-31")).toBe(20_818);
  });

  it("reads a year Date can't hold as no day", () => {
    expect(dayNumber("999999-01-01")).toBeNull();
  });

  it("keeps a year below 100 in that year", () => {
    const n = dayNumber("0026-01-05");
    if (n === null) throw new Error("no such day");

    expect(dayString(n)).toBe("0026-01-05");
  });

  it.each([
    ["month zero", "2026-00-10"],
    ["a month past December", "2026-13-01"],
    ["day zero", "2026-07-00"],
    ["a day past the 31st", "2026-07-32"],
    ["text", "not-a-day"],
    ["an empty string", ""],
  ])("reads %s as no day", (_case, raw) => {
    expect(dayNumber(raw)).toBeNull();
  });
});

describe("monthName", () => {
  it("spells the month the window label reads as prose", () => {
    expect(monthName(1)).toBe("January");
    expect(monthName(8)).toBe("August");
    expect(monthName(12)).toBe("December");
  });
});

describe("windowLabel", () => {
  // Every one is "to date", because a label reading "August 2026" alone implies a whole month was counted.
  it("says what each range actually covers", () => {
    expect(windowLabel("month", "2026-08-14")).toBe(
      "August 2026 · month to date",
    );
    expect(windowLabel("year", "2026-08-14")).toBe("2026 · year to date");
    expect(windowLabel("all_time", "2026-08-14")).toBe(
      "Everything you have tracked",
    );
  });

  it("names the week by its own Monday", () => {
    // 2026-08-14 is a Friday; its week opened on the 10th, whether or not the reader read that day.
    expect(windowLabel("week", "2026-08-14")).toBe(
      "Week of 10 Aug 2026 · to date",
    );
    // A Monday labels itself.
    expect(windowLabel("week", "2026-08-10")).toBe(
      "Week of 10 Aug 2026 · to date",
    );
  });

  it("falls back to the range's own label without a server day", () => {
    expect(windowLabel("month", "")).toBe("Month");
    expect(windowLabel("week", "not-a-day")).toBe("Week");
    expect(windowLabel("all_time", "")).toBe("Lifetime");
  });
});

describe("streakSpan", () => {
  // A run that ended yesterday is still live, since measuring back from today would outline one cell too many.
  it("measures back from the last active day, not from today", () => {
    expect(streakSpan(day(12), [day(9), day(10), day(11)], 3)).toEqual([
      day(9),
      day(11),
    ]);
  });

  it("is none without a live run or any activity", () => {
    expect(streakSpan(day(12), [day(12)], 0)).toBeNull();
    expect(streakSpan(day(12), [], 4)).toBeNull();
  });

  it("ignores activity after the anchor, which can't end a run", () => {
    expect(streakSpan(day(12), [day(20)], 3)).toBeNull();
  });
});

describe("yearFraction", () => {
  it("runs from one day in to the whole year", () => {
    expect(yearFraction("2026-01-01")).toBeCloseTo(1 / 365, 9);
    expect(yearFraction("2026-12-31")).toBe(1);
    // 2024 is a leap year, so its last day is still exactly one.
    expect(yearFraction("2024-12-31")).toBe(1);
  });

  // A server too old to send the day leaves the pace note unrendered rather than measured against a guess.
  it("is none without a server day", () => {
    expect(yearFraction("")).toBeNull();
  });
});
