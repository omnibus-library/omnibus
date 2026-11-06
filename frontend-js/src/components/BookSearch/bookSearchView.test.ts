import { describe, expect, it } from "vitest";
import type { ScanOutcome } from "../../api";
import { anExternalBook, aScanBook } from "../../testing/scanHandlers";
import { existingBook, isbnResults } from "./bookSearchView";

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
