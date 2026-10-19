import { describe, expect, it } from "vitest";
import type { SeriesSummary } from "../../api";
import {
  filterAndSortSeries,
  seriesEyebrow,
  seriesSortKey,
  splitLastWord,
} from "./seriesIndex";

function aSeries(overrides: Partial<SeriesSummary>): SeriesSummary {
  return {
    id: 1 as SeriesSummary["id"],
    name: "Foundation",
    sort: null,
    bookCount: 1,
    accent: null,
    primaryAuthor: null,
    ...overrides,
  };
}

describe("seriesSortKey", () => {
  it("prefers the series' own sort name", () => {
    expect(seriesSortKey({ name: "The Expanse", sort: "Expanse" })).toBe(
      "Expanse",
    );
  });

  it("ignores an empty sort name", () => {
    expect(seriesSortKey({ name: "Foundation", sort: "" })).toBe("Foundation");
  });

  it.each([
    ["The Foo Bar", "Foo Bar"],
    ["the foo bar", "foo bar"],
    ["Theology", "Theology"],
  ])("strips a leading article from %s", (name, key) => {
    expect(seriesSortKey({ name, sort: null })).toBe(key);
  });
});

describe("filterAndSortSeries", () => {
  const items = [
    aSeries({
      id: 1 as SeriesSummary["id"],
      name: "Foundation",
      primaryAuthor: "Asimov",
      bookCount: 7,
    }),
    aSeries({
      id: 2 as SeriesSummary["id"],
      name: "Dune",
      primaryAuthor: "Herbert",
      bookCount: 6,
    }),
    aSeries({
      id: 3 as SeriesSummary["id"],
      name: "The Culture",
      primaryAuthor: "Banks",
      bookCount: 6,
    }),
  ];

  it("orders by sort key under A to Z", () => {
    expect(filterAndSortSeries(items, "", "name").map((s) => s.name)).toEqual([
      "The Culture",
      "Dune",
      "Foundation",
    ]);
  });

  it("orders by count then sort key under Most books", () => {
    expect(
      filterAndSortSeries(items, "", "book_count").map((s) => s.name),
    ).toEqual(["Foundation", "The Culture", "Dune"]);
  });

  it("keeps a series whose name matches without regard to case", () => {
    expect(
      filterAndSortSeries(items, "FOUND", "name").map((s) => s.name),
    ).toEqual(["Foundation"]);
  });

  it("keeps a series whose primary author matches", () => {
    expect(
      filterAndSortSeries(items, "herbert", "name").map((s) => s.name),
    ).toEqual(["Dune"]);
  });
});

describe("splitLastWord", () => {
  it.each([
    ["The Wheel of Time", ["The Wheel of", "Time"]],
    ["Dune", ["", "Dune"]],
  ])("splits %s", (name, parts) => {
    expect(splitLastWord(name)).toEqual(parts);
  });
});

describe("seriesEyebrow", () => {
  const book = (index: string | null, published: string | null) => ({
    series: { index },
    published,
  });

  it("pairs the index with a real date", () => {
    expect(seriesEyebrow(book("1", "2016-05-02"))).toBe("Book #1 · May 2016");
  });

  it("reads the same for an absent and a sentinel date", () => {
    expect(seriesEyebrow(book("1", null))).toBe("Book #1");
    expect(seriesEyebrow(book("1", "0101-01-01T00:00:00+00:00"))).toBe(
      "Book #1",
    );
  });

  it("drops the separator when only a date is present", () => {
    expect(seriesEyebrow(book(null, "2016-05"))).toBe("May 2016");
    expect(seriesEyebrow(book(null, null))).toBe("");
  });
});
