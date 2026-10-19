import { describe, expect, it } from "vitest";
import {
  barWidth,
  buildPanels,
  coverageNote,
  ghostedNote,
  isEmptyComposition,
  overlapNote,
  sliceColor,
} from "./composition";

const slice = (label: string, books: number) => ({ label, books });

function dim(slices: [string, number][], covered: number) {
  return {
    slices: slices.map(([label, books]) => slice(label, books)),
    coverage: {
      total: slices.reduce((n, [, books]) => n + books, 0),
      books: covered,
    },
  };
}

const EMPTY = { slices: [], coverage: { total: 0, books: 0 } };

/** A library whose every dimension has something to say. */
const full = () => ({
  books: 1_510,
  ghosted_books: 4,
  // 1,580 placements over 1,510 books, so seventy are held in both.
  formats: {
    slices: [slice("EPUB", 1_400), slice("M4B", 180)],
    coverage: { total: 1_580, books: 1_510 },
  },
  languages: dim(
    [
      ["eng", 1_180],
      ["fra", 40],
    ],
    1_200,
  ),
  publishers: dim(
    [
      ["Tor", 90],
      ["Other", 310],
    ],
    400,
  ),
  decades: dim(
    [
      ["1990s", 200],
      ["2000s", 620],
    ],
    820,
  ),
  genres: dim(
    [
      ["Fantasy", 40],
      ["Horror", 22],
    ],
    58,
  ),
});

describe("barWidth", () => {
  it("scales to the tallest bar and survives an empty dimension", () => {
    expect(barWidth(50, 100)).toBe(50);
    expect(barWidth(100, 100)).toBe(100);
    // A dimension with nothing in it must not divide by zero on the way to drawing no bars.
    expect(barWidth(0, 0)).toBe(0);
  });
});

describe("coverageNote", () => {
  // A distribution without its coverage is a guess wearing a chart.
  it("always states the denominator", () => {
    expect(coverageNote(dim([["Fantasy", 40]], 58), 1_510)).toBe(
      "across 58 of 1,510 books",
    );
  });
});

describe("overlapNote", () => {
  it("appears only when a book is held in two formats", () => {
    expect(
      overlapNote(
        dim(
          [
            ["EPUB", 1],
            ["M4B", 1],
          ],
          2,
        ),
      ),
    ).toBeNull();
    expect(
      overlapNote({
        slices: [slice("EPUB", 2), slice("M4B", 1)],
        coverage: { total: 3, books: 2 },
      }),
    ).toBe("+1 book held in more than one format");
  });

  it("counts the overlap in books", () => {
    expect(overlapNote(full().formats)).toBe(
      "+70 books held in more than one format",
    );
  });
});

describe("ghostedNote", () => {
  it("is absent when every book still has its files", () => {
    expect(ghostedNote(0)).toBeNull();
    expect(ghostedNote(4)).toMatch(/^4 books excluded/);
    expect(ghostedNote(1)).toMatch(/^1 book excluded/);
  });

  // A paper-only check-in or a wishlist entry is counted here too, and it never had files to lose.
  it("fits a book that never had files", () => {
    expect(ghostedNote(8)).toBe(
      "8 books excluded — no files on disk (paper copies, wishlist entries, removed files)",
    );
  });
});

describe("buildPanels", () => {
  it("lists the five panels in the order they read", () => {
    expect(buildPanels(full()).map((p) => [p.title, p.testId])).toEqual([
      ["Formats", "stats-composition-formats"],
      ["Languages", "stats-composition-languages"],
      ["Publishers", "stats-composition-publishers"],
      ["Published", "stats-composition-decades"],
      ["Genres", "stats-composition-genres"],
    ]);
  });

  // 58 of 1,510 is the number that stops these slices reading as "your library's genres".
  it("gives the genre panel a coverage line that names it hand-assigned", () => {
    const genres = buildPanels(full()).find(
      (p) => p.testId === "stats-composition-genres",
    );

    expect(genres?.note).toBe("hand-assigned — across 58 of 1,510 books");
  });

  it("gives each other panel its own disclosure", () => {
    const notes = buildPanels(full()).map((p) => p.note);

    expect(notes).toEqual([
      "+70 books held in more than one format",
      "across 1,200 of 1,510 books",
      "across 400 of 1,510 books",
      "across 820 of 1,510 books",
      "hand-assigned — across 58 of 1,510 books",
    ]);
  });
});

describe("isEmptyComposition", () => {
  it("is true for a library with no live books or no dimension carrying one", () => {
    expect(isEmptyComposition({ ...full(), books: 0 })).toBe(true);
    expect(
      isEmptyComposition({
        ...full(),
        formats: EMPTY,
        languages: EMPTY,
        publishers: EMPTY,
        decades: EMPTY,
        genres: EMPTY,
      }),
    ).toBe(true);
  });

  it("is false while any dimension has something to say", () => {
    expect(isEmptyComposition({ ...full(), languages: EMPTY })).toBe(false);
    expect(
      isEmptyComposition({
        ...full(),
        formats: EMPTY,
        languages: EMPTY,
        publishers: EMPTY,
        decades: EMPTY,
      }),
    ).toBe(false);
  });
});

describe("sliceColor", () => {
  // Clamped at the faintest step rather than cycled, so a fifth row doesn't repeat the leader's accent.
  it("steps down the ramp and holds at its end", () => {
    expect([0, 1, 2, 3, 4, 9].map(sliceColor)).toEqual([
      "var(--st-donut-c0)",
      "var(--st-donut-c1)",
      "var(--st-donut-c2)",
      "var(--st-donut-c3)",
      "var(--st-donut-c3)",
      "var(--st-donut-c3)",
    ]);
  });
});
