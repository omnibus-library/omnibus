import { describe, expect, it } from "vitest";
import { aBook } from "../../testing/books";
import { applyEdit } from "./inlineEdit";

describe("applyEdit", () => {
  it("replaces the title", () => {
    expect(applyEdit(aBook(), { title: "Aurora Rising" }).title).toBe(
      "Aurora Rising",
    );
  });

  describe("series", () => {
    it("renames the series and keeps its index", () => {
      expect(applyEdit(aBook(), { series: "Dawn" }).series).toEqual({
        name: "Dawn",
        index: "1",
      });
    });

    it("starts a series with no index for a book that had none", () => {
      expect(
        applyEdit(aBook({ series: null }), { series: "Dawn" }).series,
      ).toEqual({ name: "Dawn", index: null });
    });

    it("takes the book out of its series when cleared", () => {
      expect(applyEdit(aBook(), { series: "" }).series).toBeNull();
    });
  });

  it.each([
    ["published", { published: "" }, "published"],
    ["language", { language: "" }, "language"],
  ] as const)(
    "clears %s to null when given an empty string",
    (_f, edit, key) => {
      const book = aBook({ published: "2021-03-01", language: "en" });

      expect(applyEdit(book, edit)[key]).toBeNull();
    },
  );

  it("sets published and language to the given text", () => {
    const edited = applyEdit(aBook(), { published: "1999", language: "fr" });

    expect(edited.published).toBe("1999");
    expect(edited.language).toBe("fr");
  });

  it("gives the creators' names as authors", () => {
    expect(
      applyEdit(aBook(), { creators: [{ name: "Ada" }, { name: "Sora" }] })
        .authors,
    ).toEqual(["Ada", "Sora"]);
  });

  it("replaces the tag and genre lists, including with none", () => {
    const edited = applyEdit(aBook({ subjects: ["a"], genres: ["b"] }), {
      subjects: ["cozy"],
      genres: [],
    });

    expect(edited.subjects).toEqual(["cozy"]);
    expect(edited.genres).toEqual([]);
  });

  it("returns the book's values unchanged for an empty edit", () => {
    const book = aBook({ subjects: ["a"], language: "en" });

    expect(applyEdit(book, {})).toEqual(book);
  });
});
