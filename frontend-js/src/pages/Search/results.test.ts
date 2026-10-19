import { describe, expect, it } from "vitest";
import { toPalette } from "../../api";
import { aWirePalette } from "../../testing/wire";
import { cutNote, highlightParts, sectionOrder, summaryLine } from "./results";

describe("highlightParts", () => {
  it("splits the text around each case-insensitive match", () => {
    expect(highlightParts("Dune and dunes", "DUNE")).toEqual([
      { text: "Dune", hit: true },
      { text: " and ", hit: false },
      { text: "dune", hit: true },
      { text: "s", hit: false },
    ]);
  });

  it.each([
    ["absent", "Foundation", "dune"],
    ["empty", "Foundation", ""],
  ])("returns the text whole when the query is %s", (_case, text, query) => {
    expect(highlightParts(text, query)).toEqual([{ text, hit: false }]);
  });
});

describe("summaryLine", () => {
  it("lists present categories with engine and time", () => {
    const results = toPalette(
      aWirePalette({
        book_total: 2,
        author_total: 2,
        series_total: 2,
        tag_total: 4,
        genre_total: 3,
        duration_ms: 24,
      }),
    );

    expect(summaryLine(results)).toBe(
      "2 titles · 2 authors · 2 series · 4 tags · 3 genres · fts5 · 24ms",
    );
  });

  it("singularises a lone category", () => {
    const results = toPalette(
      aWirePalette({
        books: [],
        authors: [],
        series: [],
        tags: [],
        duration_ms: 5,
      }),
    );

    expect(summaryLine(results)).toBe("1 genre · fts5 · 5ms");
  });
});

describe("sectionOrder", () => {
  it("puts tags first when the query matches a tag name", () => {
    const results = toPalette(aWirePalette());

    expect(sectionOrder(results, "OPERA")).toEqual([
      "tags",
      "books",
      "authors",
      "series",
      "genres",
    ]);
  });
});

describe("cutNote", () => {
  it("names how many an opened group still holds back", () => {
    const results = toPalette(aWirePalette({ tag_total: 812 }));

    expect(cutNote("tags", results)).toBe(
      "Showing the first 1 of 812 — narrow your search to see the rest.",
    );
  });

  it("says nothing when every hit is on the page", () => {
    expect(cutNote("tags", toPalette(aWirePalette()))).toBeNull();
  });
});
