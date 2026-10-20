import { describe, expect, it } from "vitest";
import type { BookState } from "../../api";
import { aBook, bookUuid } from "../../testing/books";
import {
  currentBook,
  currentMeta,
  groupBySeries,
  heroMeta,
  readAgo,
  seriesCount,
  shelfMeta,
  tally,
  tileBar,
} from "./authorProgress";

const DAY = 86_400;

const book = (uuid: string, series?: [string, string]) =>
  aBook({
    uuid: bookUuid(uuid),
    title: uuid.toUpperCase(),
    series: series ? { name: series[0], index: series[1] } : null,
  });

const state = (
  status: BookState["status"],
  percent: number | null = null,
  lastReadAt: number | null = null,
): BookState => ({ status, percent, lastReadAt, format: null, fileId: null });

describe("tally", () => {
  it("counts a book with no state as unread", () => {
    const books = [book("a"), book("b"), book("c")];
    const states = new Map([
      ["a", state("finished", null, 1)],
      ["b", state("reading", 40, 2)],
    ]);

    expect(tally(books, states)).toEqual({
      finished: 1,
      reading: 1,
      unread: 1,
    });
  });
});

describe("currentBook", () => {
  it("is the book in progress read last", () => {
    const books = [book("a"), book("b"), book("c")];
    const states = new Map([
      ["a", state("reading", 10, 5)],
      ["b", state("reading", 80, 9)],
      ["c", state("finished", null, 20)],
    ]);

    expect(currentBook(books, states)?.book.uuid).toBe("b");
  });

  it("is null when nothing is in progress", () => {
    const states = new Map([["a", state("finished", null, 1)]]);

    expect(currentBook([book("a")], states)).toBeNull();
  });
});

describe("currentMeta", () => {
  it("names the series, the percent and when", () => {
    const meta = currentMeta(
      book("a", ["Earthsea", "2"]),
      state("reading", 42, 10 * DAY),
      13 * DAY,
      0,
    );

    expect(meta).toBe("Earthsea 2 · 42% · read 3 days ago");
  });

  it("drops what it does not know", () => {
    expect(currentMeta(book("a"), state("reading"), DAY, 0)).toBe("");
  });
});

describe("readAgo", () => {
  it.each([
    [DAY / 2, 0, "today"],
    [DAY, 0, "yesterday"],
    [20 * DAY, 0, "2 weeks ago"],
    [95 * DAY, 0, "3 months ago"],
    [800 * DAY, 0, "2 years ago"],
  ])("reads %i since %i as %s", (now, then, label) => {
    expect(readAgo(now, then, 0)).toBe(label);
  });

  it("counts calendar days in the reader's zone", () => {
    // 23:00 then 08:00 the next morning is yesterday, not today.
    expect(readAgo(DAY + 8 * 3_600, 23 * 3_600, 0)).toBe("yesterday");
    // 18:00 and 20:00 at UTC-5 are one evening, though UTC midnight falls between.
    const at = (hour: number) => DAY + hour * 3_600 + 5 * 3_600;
    expect(readAgo(at(20), at(18), -5 * 3_600)).toBe("today");
  });
});

describe("groupBySeries", () => {
  it("keeps first-seen order and sets standalones apart", () => {
    const books = [
      book("a", ["Earthsea", "1"]),
      book("b", ["Hainish", "1"]),
      book("c"),
      book("d", ["Earthsea", "2"]),
    ];

    const { shelves, standalone } = groupBySeries(books);

    expect(shelves.map((s) => [s.name, s.books.length])).toEqual([
      ["Earthsea", 2],
      ["Hainish", 1],
    ]);
    expect(standalone).toHaveLength(1);
  });
});

describe("seriesCount", () => {
  it("counts a series once however many books it holds", () => {
    expect(seriesCount([book("a", ["X", "1"]), book("b", ["X", "2"])])).toBe(1);
  });
});

describe("shelfMeta", () => {
  it("adds finished only when there is some", () => {
    const books = [book("a"), book("b")];

    expect(shelfMeta(books, new Map())).toBe("2 books");
    expect(shelfMeta(books, new Map([["a", state("finished")]]))).toBe(
      "2 books · 1 finished",
    );
  });
});

describe("heroMeta", () => {
  it("leaves out a zero series count", () => {
    expect(heroMeta(1, 0)).toBe("1 book");
    expect(heroMeta(11, 2)).toBe("11 books · 2 series");
  });
});

describe("tileBar", () => {
  it.each([
    ["finished", state("finished"), 100],
    ["reading with a percent", state("reading", 42), 42],
    ["reading with no percent", state("reading"), 3],
    ["reading at the very start", state("reading", 1), 3],
    ["unread", state("unread"), null],
    ["no state", undefined, null],
  ])("draws %s as %s", (_condition, bookState, width) => {
    expect(tileBar(bookState)).toBe(width);
  });
});
