import { describe, expect, it } from "vitest";
import { aResumePoint } from "../../testing/books";
import {
  booksThisYear,
  clampedStars,
  IN_PROGRESS_SHOWN,
  moreOpenNote,
  resumePercent,
  resumeReadout,
  yearProjection,
} from "./readingNow";

const months = (pairs: [string, number][]) =>
  pairs.map(([month, books]) => ({ month, books }));

const summary = (asOf: string, pairs: [string, number][]) => ({
  as_of_day: asOf,
  books_per_month: months(pairs),
});

describe("booksThisYear", () => {
  // The trailing-12 series straddles two calendar years; sweeping all of it would count last autumn against this year.
  it("counts only the current year's months", () => {
    const series = months([
      ["2025-09", 3],
      ["2025-12", 4],
      ["2026-01", 2],
      ["2026-08", 5],
    ]);

    expect(booksThisYear(series, "2026")).toBe(7);
    expect(booksThisYear(series, "2025")).toBe(7);
    expect(booksThisYear(series, "2024")).toBe(0);
  });
});

describe("yearProjection", () => {
  // 2026-07-02 is day 183 of 365, a shade over half the year, so 15 books projects to about 30.
  it("extrapolates the year's pace to December", () => {
    expect(
      yearProjection(
        summary("2026-07-02", [
          ["2026-01", 8],
          ["2026-06", 7],
        ]),
      ),
    ).toBe(30);
  });

  // One book by the 5th of January projects seventy-three, which is not a forecast anybody should read.
  it("stays quiet early in the year", () => {
    expect(yearProjection(summary("2026-01-05", [["2026-01", 1]]))).toBeNull();
  });

  it("starts speaking once 15% of the year has passed", () => {
    // Day 54 of 365 is 14.8%; day 55 is 15.1%.
    expect(yearProjection(summary("2026-02-23", [["2026-02", 1]]))).toBeNull();
    expect(yearProjection(summary("2026-02-24", [["2026-02", 1]]))).toBe(7);
  });

  it("has no pace to extend when nothing was finished or the day is unknown", () => {
    expect(yearProjection(summary("2026-07-02", [["2026-01", 0]]))).toBeNull();
    expect(yearProjection(summary("", [["2026-07", 4]]))).toBeNull();
  });
});

describe("resumeReadout", () => {
  it("answers in whatever unit the book can report", () => {
    expect(resumeReadout(aResumePoint({ percent: 62 }))).toBe("62%");
  });

  // The container's marks are parts, not chapters, so a 65-chapter novel stored as 12 files is not on chapter 3.
  it("falls back to the structural position instead of a zero", () => {
    expect(resumeReadout(aResumePoint({ part: 3, partCount: 12 }))).toBe(
      "Pt 3 of 12",
    );
  });

  it("prefers a confidently resolved chapter to the part", () => {
    expect(
      resumeReadout(
        aResumePoint({ chapter: 7, chaptersTotal: 24, part: 3, partCount: 12 }),
      ),
    ).toBe("Ch 7 of 24");
  });

  it("says nothing rather than a zero the book never reported", () => {
    expect(resumeReadout(aResumePoint())).toBeNull();
    expect(resumeReadout(aResumePoint({ part: 3 }))).toBeNull();
    // A chapter without a total still outranks the part, and has nothing to read out.
    expect(
      resumeReadout(aResumePoint({ chapter: 7, part: 3, partCount: 12 })),
    ).toBeNull();
  });
});

describe("resumePercent", () => {
  it("clamps into the bar and defaults to empty", () => {
    expect(resumePercent(aResumePoint({ percent: 62 }))).toBe(62);
    expect(resumePercent(aResumePoint({ part: 3, partCount: 12 }))).toBe(0);
    expect(resumePercent(aResumePoint({ percent: 140 }))).toBe(100);
  });
});

describe("clampedStars", () => {
  // The card once rounded 4.5 up to five whole stars while the tile beside it read 4.5.
  it("keeps a half and reports an unrated book as none", () => {
    expect(clampedStars(5)).toBe(5);
    expect(clampedStars(4)).toBe(4);
    expect(clampedStars(4.5)).toBe(4.5);
    expect(clampedStars(null)).toBeNull();
    expect(clampedStars(undefined)).toBeNull();
  });

  it("clamps out-of-range values rather than overflowing the row", () => {
    expect(clampedStars(7)).toBe(5);
    expect(clampedStars(-1)).toBe(0);
  });
});

describe("moreOpenNote", () => {
  it("speaks only when the list is cut", () => {
    expect(moreOpenNote(IN_PROGRESS_SHOWN)).toBeNull();
    expect(moreOpenNote(0)).toBeNull();
    expect(moreOpenNote(IN_PROGRESS_SHOWN + 1)).toBe(
      "Showing the 3 most recently opened.",
    );
  });
});
