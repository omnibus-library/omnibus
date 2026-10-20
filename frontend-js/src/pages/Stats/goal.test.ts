import { describe, expect, it } from "vitest";
import {
  ariaValueNow,
  goalMet,
  goalPercent,
  paceNote,
  progressCaption,
  remainderCaption,
  rowLabel,
} from "./goal";

describe("progressCaption", () => {
  it("states the real ratio and singularizes a one-unit goal", () => {
    expect(progressCaption(3, 24, "book")).toBe("3 of 24 books");
    expect(progressCaption(0, 1, "book")).toBe("0 of 1 book");
    // Past the target reads as past the target, never clamped to the goal.
    expect(progressCaption(30, 24, "book")).toBe("30 of 24 books");
    expect(progressCaption(12, 30, "page")).toBe("12 of 30 pages");
    expect(progressCaption(0, 1, "minute")).toBe("0 of 1 minute");
  });
});

describe("remainderCaption", () => {
  it("counts down, then reports the goal met", () => {
    expect(remainderCaption(23, 24, "book")).toBe("1 book to go");
    expect(remainderCaption(20, 24, "book")).toBe("4 books to go");
    expect(remainderCaption(24, 24, "book")).toBe("Goal met");
    expect(remainderCaption(30, 24, "book")).toBe("Goal met");
    expect(remainderCaption(29, 30, "page")).toBe("1 page to go");
    expect(remainderCaption(5, 20, "minute")).toBe("15 minutes to go");
  });
});

describe("ariaValueNow", () => {
  // ARIA forbids a value past `aria-valuemax`; `aria-valuetext` carries the unclamped ratio.
  it("clamps into the range ARIA requires", () => {
    expect(ariaValueNow(3, 24)).toBe(3);
    expect(ariaValueNow(24, 24)).toBe(24);
    expect(ariaValueNow(30, 24)).toBe(24);
    expect(ariaValueNow(-1, 24)).toBe(0);
  });
});

describe("goalPercent", () => {
  it("clamps the bar while the caption stays honest", () => {
    expect(goalPercent({ current: 45, target: 30 })).toBe(100);
    expect(goalMet({ current: 45, target: 30 })).toBe(true);
    expect(progressCaption(45, 30, "page")).toBe("45 of 30 pages");
  });

  it("rounds down to a whole percent", () => {
    expect(goalPercent({ current: 12, target: 30 })).toBe(40);
    expect(goalPercent({ current: 1, target: 3 })).toBe(33);
  });

  it("is zero for a target it can't divide by, or progress below zero", () => {
    expect(goalPercent({ current: 5, target: 0 })).toBe(0);
    expect(goalPercent({ current: -5, target: 30 })).toBe(0);
  });
});

describe("goalMet", () => {
  it("is true at the target and past it", () => {
    expect(goalMet({ current: 29, target: 30 })).toBe(false);
    expect(goalMet({ current: 30, target: 30 })).toBe(true);
    expect(goalMet({ current: 31, target: 30 })).toBe(true);
  });
});

describe("paceNote", () => {
  // Half a year in against a 30-book target, 15 is on pace. 2026-07-02 is day 183 of 365.
  it("reports the gap against an even spread of the year", () => {
    expect(paceNote({ current: 15, target: 30 }, "2026-07-02")).toBe("on pace");
    expect(paceNote({ current: 18, target: 30 }, "2026-07-02")).toBe(
      "3 ahead of pace",
    );
    expect(paceNote({ current: 12, target: 30 }, "2026-07-02")).toBe(
      "3 behind pace",
    );
  });

  // Rust rounds -2.5 away from zero; `Math.round` would say 2. 2024-07-01 is day 183 of 366.
  it("rounds a tie on a negative gap away from zero", () => {
    expect(paceNote({ current: 0, target: 5 }, "2024-07-01")).toBe(
      "3 behind pace",
    );
    expect(paceNote({ current: 3, target: 5 }, "2024-07-01")).toBe(
      "1 ahead of pace",
    );
  });

  // A met goal has no pace left to keep, and "12 ahead of pace" beside "Goal met" is the same fact twice.
  it("is silent once the goal is met or the day is unknown", () => {
    expect(paceNote({ current: 30, target: 30 }, "2026-07-02")).toBeNull();
    expect(paceNote({ current: 1, target: 30 }, "not-a-day")).toBeNull();
  });
});

describe("rowLabel", () => {
  it("supplies the timeframe only when the card header has not", () => {
    // With a target, "a day" is what the target means.
    expect(rowLabel("Pages", true, true)).toBe("Pages a day");
    expect(rowLabel("Pages", true, false)).toBe("Pages a day");
    // With no target and no sibling goal, the header already says "Today".
    expect(rowLabel("Pages", false, true)).toBe("Pages");
    // A sibling is set, so the header says "Every day" and this row carries its own timeframe.
    expect(rowLabel("Minutes", false, false)).toBe("Minutes today");
  });
});
