import { describe, expect, it } from "vitest";
import { aBook } from "../../testing/books";
import {
  applyDelta,
  type BulkEdit,
  isEmptyEdit,
  NO_EDIT,
  overridesFor,
  removable,
} from "./bulkEdit";

const edit = (changes: Partial<BulkEdit>): BulkEdit => ({
  ...NO_EDIT,
  ...changes,
});

describe("applyDelta", () => {
  it("drops the removed values and appends the added ones in order", () => {
    expect(applyDelta(["a", "b", "c"], ["b"], ["d", "a", "e"])).toEqual([
      "a",
      "c",
      "d",
      "e",
    ]);
  });

  it("keeps a value that is both removed and added", () => {
    expect(applyDelta(["a"], ["a"], ["a"])).toEqual(["a"]);
  });

  it("matches removals exactly, not by case", () => {
    expect(applyDelta(["Cozy"], ["cozy"], [])).toEqual(["Cozy"]);
  });
});

describe("isEmptyEdit", () => {
  it("is empty for blank scalars and no lists", () => {
    expect(isEmptyEdit(edit({ series: "  ", publisher: "\t" }))).toBe(true);
  });

  it.each([
    ["an author", { authors: ["Ada"] }],
    ["a series", { series: "Saga" }],
    ["a language", { language: "en" }],
    ["a tag to remove", { removeTags: ["old"] }],
    ["a genre to add", { addGenres: ["Fantasy"] }],
  ])("is not empty with %s", (_what, changes) => {
    expect(isEmptyEdit(edit(changes))).toBe(false);
  });
});

describe("overridesFor", () => {
  it("holds only the fields the edit changes", () => {
    expect(overridesFor(aBook(), edit({ publisher: " Tor " }))).toEqual({
      publisher: "Tor",
    });
  });

  it("replaces the authors with the names given", () => {
    expect(overridesFor(aBook(), edit({ authors: ["Ada", "Bo"] }))).toEqual({
      creators: [{ name: "Ada" }, { name: "Bo" }],
    });
  });

  it("merges tags and genres into each book's own values", () => {
    const book = aBook({ subjects: ["old", "keep"], genres: ["Drama"] });

    expect(
      overridesFor(
        book,
        edit({ removeTags: ["old"], addTags: ["new"], addGenres: ["Epic"] }),
      ),
    ).toEqual({ subjects: ["keep", "new"], genres: ["Drama", "Epic"] });
  });
});

describe("removable", () => {
  it("ranks the values the books carry by frequency, then name", () => {
    const books = [
      aBook({ subjects: ["b", "a"] }),
      aBook({ subjects: ["b", "c"] }),
      aBook({ subjects: ["c"] }),
    ];

    expect(removable(books, "subjects")).toEqual([
      { name: "b", count: 2 },
      { name: "c", count: 2 },
      { name: "a", count: 1 },
    ]);
  });

  it("reads genres from the genre field", () => {
    expect(removable([aBook({ genres: ["Drama"] })], "genres")).toEqual([
      { name: "Drama", count: 1 },
    ]);
  });
});
