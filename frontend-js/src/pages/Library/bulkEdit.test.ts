import { describe, expect, it } from "vitest";
import { aBook } from "../../testing/books";
import {
  type BulkEdit,
  bulkWire,
  isEmptyEdit,
  NO_EDIT,
  removable,
} from "./bulkEdit";

const edit = (changes: Partial<BulkEdit>): BulkEdit => ({
  ...NO_EDIT,
  ...changes,
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

describe("bulkWire", () => {
  it("sends the lists as they are and nothing else for a lists-only edit", () => {
    expect(
      bulkWire(edit({ addTags: ["new"], removeGenres: ["Drama"] })),
    ).toEqual({
      add_tags: ["new"],
      remove_tags: [],
      add_genres: [],
      remove_genres: ["Drama"],
    });
  });

  it("trims the scalars and leaves out blank ones and an empty author list", () => {
    expect(bulkWire(edit({ publisher: " Tor ", series: "  " }))).toEqual({
      publisher: "Tor",
      add_tags: [],
      remove_tags: [],
      add_genres: [],
      remove_genres: [],
    });
  });

  it("sends the authors when given", () => {
    expect(bulkWire(edit({ authors: ["Ada", "Bo"] })).authors).toEqual([
      "Ada",
      "Bo",
    ]);
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
