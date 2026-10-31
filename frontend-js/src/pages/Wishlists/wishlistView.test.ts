import { describe, expect, it } from "vitest";
import type { ScanOutcome, UserId, WishlistReader } from "../../api";
import { anExternalBook, aScanBook } from "../../testing/scanHandlers";
import {
  addedLabel,
  byline,
  existingBook,
  heading,
  holdingLabel,
  isbnResults,
  readerOf,
  requestable,
  type Scope,
  scopeFrom,
  subline,
  wantedByNames,
} from "./wishlistView";

const ME = 1 as UserId;
const JORDAN = 2 as UserId;

const reader = (overrides: Partial<WishlistReader>): WishlistReader => ({
  id: 1,
  name: "Ada Lovelace",
  has_avatar: false,
  is_you: false,
  count: 0,
  ...overrides,
});

describe("scopeFrom", () => {
  it("returns your own list when there is no user", () => {
    expect(scopeFrom(null, ME)).toEqual({ kind: "you" });
  });

  it("returns everyone for all", () => {
    expect(scopeFrom("all", ME)).toEqual({ kind: "everyone" });
  });

  it("returns that reader for a positive integer", () => {
    expect(scopeFrom("2", ME)).toEqual({ kind: "reader", id: JORDAN });
  });

  it("returns your own list for your own id", () => {
    expect(scopeFrom("1", ME)).toEqual({ kind: "you" });
  });

  it.each([
    ["a word", "abc"],
    ["zero", "0"],
    ["a negative", "-2"],
    ["a fraction", "1.5"],
    ["nothing", ""],
  ])("falls back to your own list for %s", (_case, param) => {
    expect(scopeFrom(param, ME)).toEqual({ kind: "you" });
  });
});

describe("readerOf", () => {
  const readers = [
    reader({ id: 1, name: "Ada", is_you: true }),
    reader({ id: 2, name: "Jordan" }),
  ];

  it("finds you for your own list", () => {
    expect(readerOf({ kind: "you" }, readers)?.name).toBe("Ada");
  });

  it("finds the reader a list belongs to", () => {
    expect(readerOf({ kind: "reader", id: JORDAN }, readers)?.name).toBe(
      "Jordan",
    );
  });

  it("finds none for everyone's lists or a reader nobody lists", () => {
    expect(readerOf({ kind: "everyone" }, readers)).toBeNull();
    expect(readerOf({ kind: "reader", id: 9 as UserId }, readers)).toBeNull();
  });
});

describe("heading", () => {
  const readers = [
    reader({ id: 1, name: "Ada", is_you: true }),
    reader({ id: 2, name: "Jordan" }),
  ];

  it.each([
    ["you", { kind: "you" }, "Your Wishlist"],
    ["everyone", { kind: "everyone" }, "Everyone’s Wishlists"],
    ["a reader", { kind: "reader", id: JORDAN }, "Jordan’s Wishlist"],
  ] satisfies [string, Scope, string][])("names %s", (_case, scope, text) => {
    expect(heading(scope, readers)).toBe(text);
  });
});

describe("subline", () => {
  it.each([
    [1, "1 book"],
    [4, "4 books"],
  ])("counts one reader's %i books", (n, text) => {
    expect(subline({ kind: "you" }, n, 3)).toBe(text);
  });

  it("counts the books across the wishlists that hold any", () => {
    expect(subline({ kind: "everyone" }, 19, 3)).toBe(
      "19 books across 3 wishlists",
    );
  });

  it("singularises one wishlist", () => {
    expect(subline({ kind: "everyone" }, 1, 1)).toBe(
      "1 book across 1 wishlist",
    );
  });

  it("drops the wishlists until the readers have answered", () => {
    expect(subline({ kind: "everyone" }, 19, null)).toBe("19 books");
  });
});

describe("holdingLabel", () => {
  it("shows no multiplier for one", () => {
    expect(holdingLabel({ format: "PRINT", count: 1 })).toEqual({
      name: "PRINT",
      times: null,
    });
  });

  it("shows the multiplier past one", () => {
    expect(holdingLabel({ format: "EPUB", count: 3 })).toEqual({
      name: "EPUB",
      times: "×3",
    });
  });
});

describe("wantedByNames", () => {
  const wanter = (id: number, name: string) => ({ id: id as UserId, name });

  it("lists the other readers by name", () => {
    expect(wantedByNames([wanter(2, "Jordan"), wanter(3, "Riley")], ME)).toBe(
      "Jordan, Riley",
    );
  });

  it("puts you last", () => {
    expect(wantedByNames([wanter(1, "Ada"), wanter(2, "Jordan")], ME)).toBe(
      "Jordan, you",
    );
  });

  it("capitalises you when you are the only one", () => {
    expect(wantedByNames([wanter(1, "Ada")], ME)).toBe("You");
  });
});

describe("byline", () => {
  const book = (series: { name: string; index: string | null } | null) => ({
    authors: ["Dan Simmons"],
    series,
  });

  it("joins the author, the series and its number", () => {
    expect(byline(book({ name: "Hyperion Cantos", index: "1" }))).toBe(
      "Dan Simmons · Hyperion Cantos · 1",
    );
  });

  it("leaves out a series number the book lacks", () => {
    expect(byline(book({ name: "Hyperion Cantos", index: null }))).toBe(
      "Dan Simmons · Hyperion Cantos",
    );
  });

  it("is just the authors for a book outside a series", () => {
    expect(byline({ authors: ["Andy Weir", "Ines Varga"], series: null })).toBe(
      "Andy Weir, Ines Varga",
    );
  });
});

describe("addedLabel", () => {
  const NOV_2026 = Date.UTC(2026, 10, 3) / 1000;

  it("is the month and day within the current year", () => {
    expect(addedLabel(Date.UTC(2026, 9, 30, 8) / 1000, NOV_2026)).toBe(
      "Oct 30",
    );
  });

  it("adds the year for an earlier one", () => {
    expect(addedLabel(Date.UTC(2025, 7, 14, 8) / 1000, NOV_2026)).toBe(
      "Aug 14, 2025",
    );
  });
});

describe("requestable", () => {
  const held = (...formats: string[]) =>
    formats.map((format) => ({ format, count: 1 }));

  it("omits audiobook when an m4b is held", () => {
    expect(requestable(held("M4B"))).toEqual(["ebook"]);
  });

  it("omits ebook when an epub is held", () => {
    expect(requestable(held("EPUB"))).toEqual(["audiobook"]);
  });

  it("returns both when only print is held", () => {
    expect(requestable(held("PRINT"))).toEqual(["ebook", "audiobook"]);
  });

  it("returns both for a book the library only wants", () => {
    expect(requestable([])).toEqual(["ebook", "audiobook"]);
  });

  it("returns none when both an ebook and an audiobook are held", () => {
    expect(requestable(held("EPUB", "M4B"))).toEqual([]);
  });

  it.each([["M4A"], ["MP3"]])("counts %s as an audiobook", (format) => {
    expect(requestable(held(format))).toEqual(["ebook"]);
  });

  it.each([["PDF"], ["CBZ"]])("counts %s as an ebook", (format) => {
    expect(requestable(held(format))).toEqual(["audiobook"]);
  });
});

describe("isbnResults", () => {
  const book = aScanBook();
  const other = aScanBook({ uuid: "other", title: "Salt Road Revisited" });
  const online = anExternalBook();

  it.each([
    ["already_owned", { kind: "already_owned", book }],
    ["on_wishlist", { kind: "on_wishlist", book }],
    ["in_library_unowned", { kind: "in_library_unowned", book }],
  ] satisfies [string, ScanOutcome][])(
    "gives one library hit for %s",
    (_kind, outcome) => {
      expect(isbnResults(outcome)).toEqual({ library: [book], online: [] });
    },
  );

  it("gives the book and the others in library and the scanned edition online for close_match", () => {
    expect(
      isbnResults({
        kind: "close_match",
        book,
        others: [other],
        scanned: online,
      }),
    ).toEqual({ library: [book, other], online: [online] });
  });

  it("gives the online record alone for not_in_library", () => {
    expect(isbnResults({ kind: "not_in_library", online })).toEqual({
      library: [],
      online: [online],
    });
  });

  it("gives neither for unresolved", () => {
    expect(isbnResults({ kind: "unresolved" })).toEqual({
      library: [],
      online: [],
    });
  });
});

describe("existingBook", () => {
  const book = aScanBook();
  const online = anExternalBook();

  it.each([
    ["already_owned", { kind: "already_owned", book }],
    ["on_wishlist", { kind: "on_wishlist", book }],
    ["in_library_unowned", { kind: "in_library_unowned", book }],
    [
      "close_match, a different edition of the same work",
      { kind: "close_match", book, scanned: online },
    ],
  ] satisfies [string, ScanOutcome][])(
    "finds the book for %s",
    (_kind, outcome) => {
      expect(existingBook(outcome)).toBe(book);
    },
  );

  it.each([
    ["not_in_library", { kind: "not_in_library", online }],
    ["unresolved", { kind: "unresolved" }],
  ] satisfies [string, ScanOutcome][])(
    "finds none for %s, which matched no library book",
    (_kind, outcome) => {
      expect(existingBook(outcome)).toBeNull();
    },
  );
});
