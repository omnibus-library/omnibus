import { describe, expect, it } from "vitest";
import type { AuthorId, BookState, SeriesBook } from "../../api";
import { aBook, bookUuid } from "../../testing/books";
import {
  missingLabel,
  missingNumbers,
  nextAction,
  nextMeta,
  nextUp,
  seriesAuthors,
  tileCaption,
} from "./seriesProgress";

const DAY = 86_400;
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

function aSeriesBook(
  uuid: string,
  overrides: Partial<SeriesBook> & { index?: string | null } = {},
): SeriesBook {
  const { index = null, ...rest } = overrides;
  return {
    ...aBook({
      uuid: bookUuid(uuid),
      title: uuid.slice(0, 2),
      series: { name: "Aurora Station", index },
      formats: ["EPUB"],
      published: null,
    }),
    creators: [],
    ...rest,
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

describe("nextUp", () => {
  it("resumes the book in progress over an earlier unread one", () => {
    const books = [aSeriesBook(UUID_A), aSeriesBook(UUID_B)];
    const states = new Map([[UUID_B, state("reading", { lastReadAt: 5 })]]);

    const next = nextUp(books, states);

    expect(next?.kind).toBe("resume");
    expect(next?.book.uuid).toBe(UUID_B);
  });

  it("starts the first unread book in reading order", () => {
    const books = [
      aSeriesBook(UUID_A),
      aSeriesBook(UUID_B),
      aSeriesBook(UUID_C),
    ];
    const states = new Map([[UUID_A, state("finished")]]);

    expect(nextUp(books, states)).toEqual({
      kind: "start",
      book: books[1],
      state: null,
      fresh: false,
    });
  });

  it("starts book one fresh when nothing is started", () => {
    const books = [aSeriesBook(UUID_A), aSeriesBook(UUID_B)];

    expect(nextUp(books, new Map())).toEqual({
      kind: "start",
      book: books[0],
      state: null,
      fresh: true,
    });
  });

  it("offers nothing once every book is finished", () => {
    const books = [aSeriesBook(UUID_A), aSeriesBook(UUID_B)];
    const states = new Map([
      [UUID_A, state("finished")],
      [UUID_B, state("finished")],
    ]);

    expect(nextUp(books, states)).toBeNull();
  });

  it("keeps the position of a book marked unread", () => {
    const books = [aSeriesBook(UUID_A)];
    const kept = state("unread", { format: "epub", percent: 12 });

    expect(nextUp(books, new Map([[UUID_A, kept]]))).toEqual({
      kind: "start",
      book: books[0],
      state: kept,
      fresh: true,
    });
  });
});

describe("nextMeta", () => {
  it("names the number percent and when to resume", () => {
    const book = aSeriesBook(UUID_A, { index: "3" });
    const reading = state("reading", { percent: 42, lastReadAt: 10 * DAY });

    expect(
      nextMeta({ kind: "resume", book, state: reading }, 13 * DAY, 0),
    ).toBe("Book 3 · 42% · read 3 days ago");
  });

  it("says start here for a fresh series", () => {
    const book = aSeriesBook(UUID_A, { index: "1" });

    expect(
      nextMeta({ kind: "start", book, state: null, fresh: true }, DAY, 0),
    ).toBe("Start here · Book 1");
  });

  it("says up next once a book is finished", () => {
    const book = aSeriesBook(UUID_B, { index: "4" });

    expect(
      nextMeta({ kind: "start", book, state: null, fresh: false }, DAY, 0),
    ).toBe("Up next · Book 4");
  });

  it.each([
    ["start here", true, "Start here"],
    ["up next", false, "Up next"],
  ])("says just %s for a book with no number", (_condition, fresh, label) => {
    const book = aSeriesBook(UUID_A);

    expect(nextMeta({ kind: "start", book, state: null, fresh }, DAY, 0)).toBe(
      label,
    );
  });

  it("says up next rather than start here for a kept position", () => {
    const book = aSeriesBook(UUID_A, { index: "1" });
    const kept = state("unread", { format: "epub", percent: 12 });

    expect(
      nextMeta({ kind: "start", book, state: kept, fresh: true }, DAY, 0),
    ).toBe("Up next · Book 1 · 12%");
  });
});

describe("nextAction", () => {
  it("starts a fresh book at its beginning", () => {
    const book = aSeriesBook(UUID_A);

    expect(
      nextAction({ kind: "start", book, state: null, fresh: true }),
    ).toEqual({
      label: "Start",
      to: `/read/${UUID_A}`,
      testid: "series-next",
      actionTestid: "series-start",
    });
  });

  it("resumes an unread book where its kept position is", () => {
    const book = aSeriesBook(UUID_A, { formats: ["M4B"] });
    const kept = state("unread", { format: "audio", fileId: 7 });

    expect(
      nextAction({ kind: "start", book, state: kept, fresh: false }),
    ).toEqual({
      label: "Resume",
      to: `/listen/${UUID_A}?file_id=7`,
      testid: "series-next",
      actionTestid: "series-resume",
    });
  });

  it("resumes the book in progress in its format", () => {
    const book = aSeriesBook(UUID_A, { formats: ["EPUB", "M4B"] });
    const reading = state("reading", { format: "audio", fileId: 9 });

    expect(nextAction({ kind: "resume", book, state: reading })).toEqual({
      label: "Resume",
      to: `/listen/${UUID_A}?file_id=9`,
      testid: "series-current",
      actionTestid: "series-resume",
    });
  });

  it("resumes a book marked reading that has no position yet", () => {
    const book = aSeriesBook(UUID_A);

    expect(
      nextAction({ kind: "resume", book, state: state("reading") }),
    ).toEqual({
      label: "Resume",
      to: `/read/${UUID_A}`,
      testid: "series-current",
      actionTestid: "series-resume",
    });
  });
});

describe("tileCaption", () => {
  it("pairs the number with a real year", () => {
    const book = aSeriesBook(UUID_A, { index: "1", published: "2016-05-02" });

    expect(tileCaption(book)).toBe("Book 1 · 2016");
  });

  it.each([
    ["an absent date", null],
    ["a sentinel date", "0101-01-01T00:00:00+00:00"],
  ])("reads the same for %s", (_condition, published) => {
    expect(tileCaption(aSeriesBook(UUID_A, { index: "2", published }))).toBe(
      "Book 2",
    );
  });

  it("keeps an empty number as a blank one", () => {
    const book = aSeriesBook(UUID_A, { index: "", published: "2016-05-02" });

    expect(tileCaption(book)).toBe("Book  · 2016");
  });

  it("keeps a lone year", () => {
    expect(tileCaption(aSeriesBook(UUID_A, { published: "2016-05-02" }))).toBe(
      "2016",
    );
  });

  it("is null with neither", () => {
    expect(tileCaption(aSeriesBook(UUID_A))).toBeNull();
  });
});

describe("missingNumbers", () => {
  const held = (...indexes: (string | null)[]) =>
    indexes.map((index) => aSeriesBook(UUID_A, { index }));

  it("lists the whole numbers below the highest held", () => {
    expect(missingNumbers(held("1", "4", "6"))).toEqual([2, 3, 5]);
  });

  it.each([
    ["a trailing point", "3."],
    ["a plus sign", "+3"],
    ["an exponent", "3e0"],
  ])("reads %s as a whole number", (_condition, index) => {
    expect(missingNumbers(held("1", index))).toEqual([2]);
  });

  it("ignores a numbering past the scan limit", () => {
    expect(missingNumbers(held("1", "3", "2024"))).toEqual([2]);
    expect(missingNumbers(held("2024"))).toEqual([]);
  });

  it.each([
    ["a fractional number", "2.5"],
    ["a bare fraction", ".5"],
    ["a non-numeric one", "omnibus"],
    ["an empty one", ""],
    ["none", null],
  ])("neither counts nor fills a gap for %s", (_condition, index) => {
    expect(missingNumbers(held("1", "3", index))).toEqual([2]);
  });

  it("holds the highest allowed number as a bound", () => {
    expect(missingNumbers(held("200"))).toHaveLength(199);
  });
});

describe("missingLabel", () => {
  it("collapses runs", () => {
    expect(missingLabel([2, 3, 5])).toBe("Not in your library: #2–3, #5");
  });

  it("is null without a gap", () => {
    expect(missingLabel([])).toBeNull();
  });
});

describe("seriesAuthors", () => {
  const credit = (name: string, id: number | null, role: string | null) => ({
    name,
    id: id as AuthorId | null,
    role,
  });

  it("takes each book's first author once in reading order", () => {
    const books = [
      aSeriesBook(UUID_A, { creators: [credit("Frank Herbert", 1, null)] }),
      aSeriesBook(UUID_B, { creators: [credit("Frank Herbert", 1, "aut")] }),
      aSeriesBook(UUID_C, {
        creators: [
          credit("Brian Herbert", null, "aut"),
          credit("Other", 3, null),
        ],
      }),
    ];

    expect(seriesAuthors(books)).toEqual([
      { name: "Frank Herbert", id: 1 },
      { name: "Brian Herbert", id: null },
    ]);
  });

  it("skips a credit whose role is not aut", () => {
    const books = [
      aSeriesBook(UUID_A, {
        creators: [
          credit("A Translator", 2, "trl"),
          credit("Ann Leckie", 5, "aut"),
        ],
      }),
      aSeriesBook(UUID_B, { creators: [credit("An Editor", 4, "edt")] }),
    ];

    expect(seriesAuthors(books)).toEqual([{ name: "Ann Leckie", id: 5 }]);
  });
});
