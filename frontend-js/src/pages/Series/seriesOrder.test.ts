import { describe, expect, it } from "vitest";
import {
  type SeriesSummary,
  toSeriesReading,
  toSeriesSummary,
} from "../../api";
import { aWireSeriesReading, aWireSeriesSummary } from "../../testing/wire";
import {
  bySeries,
  computeSeriesGroups,
  defaultSeries,
  firstLetter,
  rowLabel,
  seriesSortKey,
} from "./seriesOrder";

function aSeries(
  name: string,
  overrides: Partial<Parameters<typeof aWireSeriesSummary>[0]> = {},
): SeriesSummary {
  return toSeriesSummary(
    aWireSeriesSummary({
      name,
      sort: null,
      primary_author: null,
      book_count: 1,
      ...overrides,
    }),
  );
}

const names = (series: SeriesSummary[]) => series.map((s) => s.name);

const noFilter = { text: "", reading: null, onlyReading: false };

const readingOf = (...rows: Parameters<typeof aWireSeriesReading>[0][]) =>
  bySeries(rows.map((row) => toSeriesReading(aWireSeriesReading(row))));

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

describe("firstLetter", () => {
  it("files The Expanse under E", () => {
    expect(firstLetter(aSeries("The Expanse"))).toBe("E");
  });

  it.each(["1984 Saga", "[Untitled]"])("files %s under #", (name) => {
    expect(firstLetter(aSeries(name))).toBe("#");
  });
});

describe("computeSeriesGroups", () => {
  it("matches a name typed without its accents", () => {
    const all = [
      aSeries("Éclair Cycle", { id: 1 }),
      aSeries("Dune", { id: 2 }),
    ];

    const { filtered } = computeSeriesGroups(all, {
      ...noFilter,
      text: "eclair",
      sort: "name",
    });

    expect(names(filtered)).toEqual(["Éclair Cycle"]);
  });

  it("matches the primary author", () => {
    const all = [
      aSeries("Dune", { id: 1, primary_author: "Frank Herbert" }),
      aSeries("Foundation", { id: 2, primary_author: "Isaac Asimov" }),
    ];

    const { filtered } = computeSeriesGroups(all, {
      ...noFilter,
      text: "HERBERT",
      sort: "name",
    });

    expect(names(filtered)).toEqual(["Dune"]);
  });

  it("orders by sort key in dictionary order with the non-alphabetic bucket last", () => {
    const all = [
      aSeries("1984 Saga", { id: 1 }),
      aSeries("Foundation", { id: 2 }),
      aSeries("The Expanse", { id: 3 }),
      aSeries("Éclair Cycle", { id: 4 }),
      aSeries("apple", { id: 5 }),
    ];

    const { filtered } = computeSeriesGroups(all, {
      ...noFilter,
      sort: "name",
    });

    expect(names(filtered)).toEqual([
      "apple",
      "Éclair Cycle",
      "The Expanse",
      "Foundation",
      "1984 Saga",
    ]);
  });

  it("orders by book count then name", () => {
    const all = [
      aSeries("Dune", { id: 1, book_count: 6 }),
      aSeries("Foundation", { id: 2, book_count: 7 }),
      aSeries("The Culture", { id: 3, book_count: 6 }),
    ];

    const { filtered } = computeSeriesGroups(all, {
      ...noFilter,
      sort: "book_count",
    });

    expect(names(filtered)).toEqual(["Foundation", "The Culture", "Dune"]);
  });

  it("puts the latest read first and the never-read after by name", () => {
    const all = [
      aSeries("Dune", { id: 1 }),
      aSeries("Foundation", { id: 2 }),
      aSeries("The Culture", { id: 3 }),
      aSeries("Anathem", { id: 4 }),
    ];
    const reading = readingOf(
      { series_id: 1, last_read_at: 10 },
      { series_id: 2, last_read_at: 20 },
    );

    const { filtered } = computeSeriesGroups(all, {
      text: "",
      sort: "recent",
      reading,
      onlyReading: false,
    });

    expect(names(filtered)).toEqual([
      "Foundation",
      "Dune",
      "Anathem",
      "The Culture",
    ]);
  });

  it("keeps only series in progress when asked", () => {
    const all = [aSeries("Dune", { id: 1 }), aSeries("Foundation", { id: 2 })];
    const reading = readingOf(
      { series_id: 1, reading: 0 },
      { series_id: 2, reading: 1 },
    );

    const { filtered } = computeSeriesGroups(all, {
      text: "",
      sort: "name",
      reading,
      onlyReading: true,
    });

    expect(names(filtered)).toEqual(["Foundation"]);
  });

  it("ignores the reading filter until progress loads", () => {
    const all = [aSeries("Dune")];

    const { filtered } = computeSeriesGroups(all, {
      ...noFilter,
      sort: "name",
      onlyReading: true,
    });

    expect(names(filtered)).toEqual(["Dune"]);
  });

  it("draws letter groups only under the name sort", () => {
    const all = [aSeries("The Expanse", { id: 1 }), aSeries("Dune", { id: 2 })];

    const byName = computeSeriesGroups(all, { ...noFilter, sort: "name" });
    const byCount = computeSeriesGroups(all, {
      ...noFilter,
      sort: "book_count",
    });

    expect(
      byName.letters.map(([letter, group]) => [letter, names(group)]),
    ).toEqual([
      ["D", ["Dune"]],
      ["E", ["The Expanse"]],
    ]);
    expect(byCount.letters).toEqual([]);
  });
});

describe("defaultSeries", () => {
  const all = [
    aSeries("Dune", { id: 1 }),
    aSeries("Foundation", { id: 2 }),
    aSeries("Anathem", { id: 3 }),
  ];

  it("is the series read most recently", () => {
    const reading = readingOf(
      { series_id: 1, last_read_at: 50 },
      { series_id: 2, last_read_at: 10 },
    );

    expect(defaultSeries(all, reading)).toBe(1);
  });

  it("breaks a tie on last read toward the higher id", () => {
    const reading = readingOf(
      { series_id: 1, last_read_at: 50 },
      { series_id: 2, last_read_at: 50 },
    );

    expect(defaultSeries(all, reading)).toBe(2);
  });

  it("falls back to the first by name", () => {
    expect(defaultSeries(all, null)).toBe(3);
  });

  it("is null for an empty library", () => {
    expect(defaultSeries([], null)).toBeNull();
  });
});

describe("rowLabel", () => {
  const dune = aSeries("Dune", {
    id: 1,
    primary_author: "Frank Herbert",
    book_count: 6,
  });

  it("names the series author count and finished", () => {
    const progress = toSeriesReading(
      aWireSeriesReading({ series_id: 1, finished: 2 }),
    );

    expect(rowLabel(dune, progress)).toBe(
      "Dune, by Frank Herbert, 6 books, 2 finished",
    );
  });

  it("leaves out an unknown author and none finished", () => {
    const lone = aSeries("Dune", { primary_author: null, book_count: 1 });

    expect(rowLabel(lone, undefined)).toBe("Dune, 1 book");
  });
});
