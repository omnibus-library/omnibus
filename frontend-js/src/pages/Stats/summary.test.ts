import { describe, expect, it } from "vitest";
import { ApiError } from "../../api";
import {
  failureOf,
  formatActiveTime,
  freshnessNote,
  groupThousands,
  hasTimePatterns,
  isEmpty,
  RANGE_LABELS,
  RANGES,
} from "./summary";

const quiet = { reading_seconds: 0, listening_seconds: 0, books_finished: 0 };

describe("isEmpty", () => {
  it("is true only without recorded time or finishes", () => {
    expect(isEmpty(quiet)).toBe(true);
    expect(isEmpty({ ...quiet, reading_seconds: 1 })).toBe(false);
    expect(isEmpty({ ...quiet, listening_seconds: 1 })).toBe(false);
    expect(isEmpty({ ...quiet, books_finished: 1 })).toBe(false);
  });

  // `sessions` is filtered by a minimum sitting length, so a reader of glances has none
  // but still has time read to show; the page must not blank on it.
  it("is false for recorded time that no sitting qualified for", () => {
    expect(isEmpty({ ...quiet, reading_seconds: 1650 })).toBe(false);
  });
});

describe("hasTimePatterns", () => {
  it("is true only when some local hour carries activity", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      seconds: 0,
    }));

    // Zero-filled to 24 either way, so the count can't be the predicate.
    expect(hasTimePatterns({ hour_of_day: hours })).toBe(false);
    expect(
      hasTimePatterns({
        hour_of_day: hours.map((h) =>
          h.hour === 21 ? { ...h, seconds: 600 } : h,
        ),
      }),
    ).toBe(true);
    expect(hasTimePatterns({ hour_of_day: [] })).toBe(false);
  });
});

describe("RANGES", () => {
  it("lists the periods in switcher order with their pill labels", () => {
    expect(RANGES.map((range) => RANGE_LABELS[range])).toEqual([
      "Week",
      "Month",
      "Year",
      "Lifetime",
    ]);
  });
});

describe("groupThousands", () => {
  it.each([
    [0, "0"],
    [9, "9"],
    [999, "999"],
    [1000, "1,000"],
    [1_234_567, "1,234,567"],
    [-42, "-42"],
    [-1234, "-1234"],
  ])("writes %i as %s", (n, written) => {
    expect(groupThousands(n)).toBe(written);
  });
});

describe("formatActiveTime", () => {
  it.each([
    [42 * 60, "42 m"],
    [3 * 3600, "3 h"],
    [3 * 3600 + 20 * 60, "3 h 20 m"],
  ])("writes %i seconds as %s", (secs, written) => {
    expect(formatActiveTime(secs)).toBe(written);
  });
});

describe("freshnessNote", () => {
  it("states the server's cache lifetime in seconds", () => {
    expect(freshnessNote()).toBe("Stats are accurate to the last ~60 seconds.");
  });
});

describe("failureOf", () => {
  it("maps a refusal to not sharing", () => {
    expect(failureOf(new ApiError(404, "no such reader"))).toEqual({
      kind: "not_sharing",
    });
  });

  it("keeps any other message verbatim", () => {
    expect(failureOf(new ApiError(500, "boom"))).toEqual({
      kind: "other",
      message: "boom",
    });
    expect(failureOf(new Error("offline"))).toEqual({
      kind: "other",
      message: "offline",
    });
  });
});
