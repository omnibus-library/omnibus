import { describe, expect, it } from "vitest";
import type { BookState } from "../../api";
import { aBook, bookUuid } from "../../testing/books";
import {
  currentMeta,
  groupBySeries,
  heroMeta,
  seriesCount,
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

describe("heroMeta", () => {
  it("leaves out a zero series count", () => {
    expect(heroMeta(1, 0)).toBe("1 book");
    expect(heroMeta(11, 2)).toBe("11 books · 2 series");
  });
});
