import { describe, expect, it } from "vitest";
import {
  chapterIndexForElapsed,
  formatHms,
  kickerText,
  rateLabel,
} from "./listen";

const chapters = [
  { title: "One", start: 0, seconds: 300 },
  { title: "Two", start: 300, seconds: 300 },
  { title: "Three", start: 600, seconds: 300 },
];

describe("kickerText", () => {
  it("counts the chapters once the book has them", () => {
    expect(kickerText(5, 2)).toBe("Now playing · Chapter 3 of 5");
  });

  it("is plain without chapters", () => {
    expect(kickerText(0, 0)).toBe("Now playing");
  });
});

describe("rateLabel", () => {
  it("shows two decimals and a multiplication sign", () => {
    expect(rateLabel(1.5)).toBe("1.50×");
    expect(rateLabel(1)).toBe("1.00×");
  });
});

describe("formatHms", () => {
  it("drops the hour under an hour", () => {
    expect(formatHms(0)).toBe("0:00");
    expect(formatHms(75.9)).toBe("1:15");
    expect(formatHms(3600)).toBe("1:00:00");
    expect(formatHms(10_822)).toBe("3:00:22");
  });

  it("reads anything that isn't a time as 0:00", () => {
    expect(formatHms(-1)).toBe("0:00");
    expect(formatHms(Number.NaN)).toBe("0:00");
    expect(formatHms(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("chapterIndexForElapsed", () => {
  it("is the last chapter that has started", () => {
    expect(chapterIndexForElapsed(chapters, 0)).toBe(0);
    expect(chapterIndexForElapsed(chapters, 299)).toBe(0);
    expect(chapterIndexForElapsed(chapters, 300)).toBe(1);
    expect(chapterIndexForElapsed(chapters, 9999)).toBe(2);
  });

  it("is 0 with no chapters, or before the first starts", () => {
    expect(chapterIndexForElapsed([], 50)).toBe(0);
    expect(
      chapterIndexForElapsed([{ title: "", start: 20, seconds: 5 }], 3),
    ).toBe(0);
  });
});
