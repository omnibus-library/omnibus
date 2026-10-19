import { describe, expect, it } from "vitest";
import {
  buildRows,
  daysDetail,
  fastestReadNote,
  pagesDetail,
  prettyDay,
} from "./superlatives";

const NONE: Parameters<typeof buildRows>[0] = {
  superlatives: {
    biggest_day: null,
    fastest_read: null,
    longest_book: null,
    longest_sit: null,
    shortest_book: null,
  },
  busiest_week_start: null,
  busiest_week_seconds: 0,
  top_authors: [],
  top_tags: [],
};

const book = (title: string, value: number) => ({
  book_uuid: title,
  title,
  author: null,
  value,
});

describe("prettyDay", () => {
  it("writes a readable date", () => {
    expect(prettyDay("2023-11-14")).toBe("14 Nov 2023");
  });

  it("passes a malformed day through rather than dropping its label", () => {
    expect(prettyDay("not-a-day")).toBe("not-a-day");
  });
});

describe("pagesDetail and daysDetail", () => {
  it("singularize", () => {
    expect(pagesDetail(1)).toBe("1 page");
    expect(pagesDetail(412)).toBe("412 pages");
    expect(daysDetail(1)).toBe("in a day");
    expect(daysDetail(3)).toBe("in 3 days");
  });
});

describe("buildRows", () => {
  // An absent superlative costs its row, not an em-dash.
  it("omits every superlative the server left out", () => {
    expect(buildRows(NONE)).toEqual([]);
  });

  it("renders each superlative the window supports, in reading order", () => {
    const rows = buildRows({
      superlatives: {
        longest_book: book("Doorstopper", 900),
        shortest_book: book("Novella", 90),
        biggest_day: { day: "2023-11-14", seconds: 7200 },
        longest_sit: book("Marathon", 5400),
        fastest_read: book("Sprint", 3),
      },
      busiest_week_start: "2023-11-13",
      busiest_week_seconds: 14_400,
      top_authors: [{ name: "Ursula K. Le Guin", seconds: 3600 }],
      top_tags: [{ name: "Science Fiction", seconds: 1800 }],
    });

    expect(rows.map((r) => r.label)).toEqual([
      "Longest book",
      "Shortest book",
      "Fastest read",
      "Longest sitting",
      "Biggest day",
      "Busiest week",
      "Most-read author",
      "Most-read subject",
    ]);
    expect(rows[0]).toMatchObject({
      headline: "Doorstopper",
      detail: "900 pages",
    });
    expect(rows[2]?.detail).toBe("in 3 days");
    expect(rows[3]?.detail).toBe("1 h 30 m");
    expect(rows[4]?.headline).toBe("14 Nov 2023");
    expect(rows[5]).toMatchObject({
      headline: "Week of 13 Nov 2023",
      detail: "4 h",
    });
    expect(rows[6]).toMatchObject({
      headline: "Ursula K. Le Guin",
      detail: "1 h",
    });
    expect(rows[7]).toMatchObject({
      headline: "Science Fiction",
      detail: "30 m",
    });
  });

  // The field is on every payload and zeroed for an empty window.
  it("omits the busiest week when it carries no seconds", () => {
    expect(
      buildRows({
        ...NONE,
        busiest_week_start: "2023-11-13",
        busiest_week_seconds: 0,
      }),
    ).toEqual([]);
  });

  it("omits a ranking whose leader has no time behind it", () => {
    expect(
      buildRows({ ...NONE, top_authors: [{ name: "Nobody", seconds: 0 }] }),
    ).toEqual([]);
  });

  it("keeps a lone busiest week, which the superlatives struct alone would miss", () => {
    const rows = buildRows({
      ...NONE,
      busiest_week_start: "2023-11-13",
      busiest_week_seconds: 3600,
    });

    expect(rows.map((r) => r.label)).toEqual(["Busiest week"]);
  });
});

describe("fastestReadNote", () => {
  it("states the floor in minutes rather than a hardcoded sentence", () => {
    expect(fastestReadNote()).toContain("at least 30 m of recorded time");
  });
});
