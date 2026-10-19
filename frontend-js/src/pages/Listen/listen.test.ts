import { describe, expect, it } from "vitest";
import {
  chapterFillPct,
  chapterIndexForElapsed,
  chapterNextTarget,
  chapterPrevTarget,
  chapterSubText,
  effectiveScrubPosition,
  formatHms,
  kickerText,
  noChapterFillPct,
  rateLabel,
  remainingAtRate,
  thumbPct,
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

describe("chapterPrevTarget", () => {
  it("restarts the chapter once more than 3 s in", () => {
    expect(chapterPrevTarget(chapters, 350, 1)).toBe(300);
  });

  it("goes to the previous chapter within 3 s of the start", () => {
    expect(chapterPrevTarget(chapters, 301, 1)).toBe(0);
    expect(chapterPrevTarget(chapters, 303, 1)).toBe(0);
  });

  it("goes to 0 from the first chapter", () => {
    expect(chapterPrevTarget(chapters, 1, 0)).toBe(0);
  });

  it("is null with no chapters or a stale index", () => {
    expect(chapterPrevTarget([], 10, 0)).toBeNull();
    expect(chapterPrevTarget(chapters, 1, 5)).toBeNull();
  });
});

describe("chapterNextTarget", () => {
  it("is the next chapter's start", () => {
    expect(chapterNextTarget(chapters, 0)).toBe(300);
  });

  it("is null on the last chapter, with no chapters, or a stale index", () => {
    expect(chapterNextTarget(chapters, 2)).toBeNull();
    expect(chapterNextTarget([], 0)).toBeNull();
    expect(chapterNextTarget(chapters, 5)).toBeNull();
  });
});

describe("chapterSubText", () => {
  it("names the chapter by its number and title", () => {
    expect(chapterSubText(chapters, 1)).toBe("Ch. 2 · Two");
  });

  it("is null with no chapters or an untitled one", () => {
    expect(chapterSubText([], 0)).toBeNull();
    expect(chapterSubText([{ title: "", start: 0, seconds: 5 }], 0)).toBeNull();
  });
});

describe("chapterFillPct", () => {
  const chapter = { title: "", start: 200, seconds: 200 };

  it("is full for played chapters and empty for upcoming ones", () => {
    expect(chapterFillPct(0, 2, 500, chapter)).toBe(100);
    expect(chapterFillPct(3, 1, 300, chapter)).toBe(0);
  });

  it("is proportional for the current chapter, clamped at both ends", () => {
    expect(chapterFillPct(1, 1, 250, chapter)).toBe(25);
    expect(chapterFillPct(1, 1, 999, chapter)).toBe(100);
    expect(chapterFillPct(1, 1, 100, chapter)).toBe(0);
  });
});

describe("noChapterFillPct", () => {
  it("is proportional to the duration, and 0 while it is unknown", () => {
    expect(noChapterFillPct(30, 120)).toBe(25);
    expect(noChapterFillPct(0, 0)).toBe(0);
  });
});

describe("thumbPct", () => {
  it("is proportional, clamped to the bar, and 0 without a length", () => {
    expect(thumbPct(100, 200)).toBe(50);
    expect(thumbPct(999, 200)).toBe(100);
    expect(thumbPct(-5, 200)).toBe(0);
    expect(thumbPct(10, 0)).toBe(0);
  });
});

describe("effectiveScrubPosition", () => {
  it("passes elapsed through when not dragging", () => {
    expect(effectiveScrubPosition(chapters, 120, 900, null)).toEqual({
      position: 120,
      index: 0,
      remaining: 780,
    });
  });

  it("previews the drag target in every readout", () => {
    expect(effectiveScrubPosition(chapters, 120, 900, 500)).toEqual({
      position: 500,
      index: 1,
      remaining: 400,
    });
  });

  it("changes chapter exactly at a boundary", () => {
    expect(effectiveScrubPosition(chapters, 0, 900, 299.9).index).toBe(0);
    expect(effectiveScrubPosition(chapters, 0, 900, 300).index).toBe(1);
  });

  it("clamps a drag target into the book", () => {
    expect(effectiveScrubPosition(chapters, 0, 300, 999)).toMatchObject({
      position: 300,
      remaining: 0,
    });
    expect(effectiveScrubPosition(chapters, 120, 300, -50)).toMatchObject({
      position: 0,
      index: 0,
      remaining: 300,
    });
  });
});

describe("remainingAtRate", () => {
  it("divides by the speed", () => {
    expect(remainingAtRate(600, 2)).toBe(300);
    expect(remainingAtRate(600, 0.5)).toBe(1200);
  });

  it("leaves the time alone for a speed that can't divide", () => {
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(remainingAtRate(600, rate)).toBe(600);
    }
  });
});
