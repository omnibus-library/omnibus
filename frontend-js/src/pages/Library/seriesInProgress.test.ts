import { describe, expect, it } from "vitest";
import type {
  BookState,
  SeriesBook,
  SeriesId,
  SeriesInProgress,
} from "../../api";
import { aBook, bookUuid } from "../../testing/books";
import { seriesRow } from "./seriesInProgress";

const uuid = (n: number) =>
  bookUuid(`${String(n).repeat(8)}-1111-4111-8111-111111111111`);

function aSeriesBook(
  n: number,
  overrides: Partial<SeriesBook> = {},
): SeriesBook {
  return {
    ...aBook({
      uuid: uuid(n),
      title: `Book title ${n}`,
      series: { name: "Aurora Station", index: String(n) },
      formats: ["EPUB"],
    }),
    creators: [],
    ...overrides,
  };
}

const state = (
  status: BookState["status"],
  overrides: Partial<BookState> = {},
): BookState => ({
  status,
  percent: null,
  lastReadAt: null,
  format: null,
  fileId: null,
  ...overrides,
});

function aSeries(
  books: SeriesBook[],
  states: [number, BookState][],
  nextN: number,
): SeriesInProgress {
  return {
    id: 4 as SeriesId,
    name: "Aurora Station",
    bookCount: books.length,
    books,
    reading: new Map(states.map(([n, s]) => [uuid(n), s])),
    hiddenFromHome: false,
    nextUuid: uuid(nextN),
    lastReadAt: null,
  };
}

const books = (count: number) =>
  Array.from({ length: count }, (_, i) => aSeriesBook(i + 1));

describe("seriesRow", () => {
  describe("subtitle", () => {
    it("names the next book by number and title", () => {
      const row = seriesRow(aSeries(books(3), [[1, state("finished")]], 2));

      expect(row?.subtitle).toBe("Up next · Book 2 · Book title 2");
    });

    it("adds the percent when the next book is being read", () => {
      const row = seriesRow(
        aSeries(books(3), [[2, state("reading", { percent: 42 })]], 2),
      );

      expect(row?.subtitle).toBe("Up next · Book 2 · Book title 2 · 42%");
    });

    it("drops the number when the next book has none", () => {
      const list = [aSeriesBook(1), aSeriesBook(2, { series: null })];

      const row = seriesRow(aSeries(list, [[1, state("finished")]], 2));

      expect(row?.subtitle).toBe("Up next · Book title 2");
    });
  });

  describe("segments", () => {
    it("fills finished books, sizes a book in progress by its percent and leaves unread empty", () => {
      const row = seriesRow(
        aSeries(
          books(4),
          [
            [1, state("finished")],
            [2, state("reading", { percent: 40 })],
            [3, state("reading", { percent: 0 })],
          ],
          2,
        ),
      );

      expect(row?.segments).toEqual([100, 40, 3, 0]);
      expect([row?.finished, row?.total]).toEqual([1, 4]);
    });
  });

  describe("action", () => {
    it("starts an unread next book in the reader", () => {
      const row = seriesRow(aSeries(books(2), [[1, state("finished")]], 2));

      expect(row?.action).toMatchObject({
        label: "Start",
        to: `/read/${uuid(2)}`,
      });
    });

    it("resumes the book being read where its audio position is", () => {
      const list = [aSeriesBook(1), aSeriesBook(2, { formats: ["M4B"] })];
      const reading = state("reading", { format: "audio", fileId: 7 });

      const row = seriesRow(aSeries(list, [[2, reading]], 2));

      expect(row?.action).toMatchObject({
        label: "Resume",
        to: `/listen/${uuid(2)}?file_id=7`,
      });
    });

    it("resumes an unread next book that kept a position", () => {
      const kept = state("unread", { format: "epub", percent: 12 });

      const row = seriesRow(aSeries(books(2), [[2, kept]], 2));

      expect(row?.action.label).toBe("Resume");
    });
  });

  describe("leaves", () => {
    it("puts the next book first, then the rest in reading order, at most three", () => {
      const row = seriesRow(aSeries(books(5), [[1, state("finished")]], 3));

      expect(row?.leaves.map((b) => b.uuid)).toEqual([
        uuid(3),
        uuid(1),
        uuid(2),
      ]);
    });

    it("holds every book of a short series", () => {
      const row = seriesRow(aSeries(books(2), [[1, state("finished")]], 2));

      expect(row?.leaves.map((b) => b.uuid)).toEqual([uuid(2), uuid(1)]);
    });
  });

  it("returns nothing when the next book is not among the series' books", () => {
    const series = { ...aSeries(books(2), [], 1), nextUuid: uuid(5) };

    expect(seriesRow(series)).toBeNull();
  });
});
