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
    it("renames the series", () => {
      expect(applyEdit(aBook(), { series: "Dawn" }).series?.name).toBe("Dawn");
    });

    it("keeps the series index when renaming", () => {
      expect(applyEdit(aBook(), { series: "Dawn" }).series?.index).toBe("1");
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

  it("sets published to the given text", () => {
    expect(applyEdit(aBook(), { published: "1999" }).published).toBe("1999");
  });

  it("sets language to the given text", () => {
    expect(applyEdit(aBook(), { language: "fr" }).language).toBe("fr");
  });

  it("gives creator names as authors", () => {
    expect(
      applyEdit(aBook(), { creators: [{ name: "Ada" }, { name: "Sora" }] })
        .authors,
    ).toEqual(["Ada", "Sora"]);
  });

  it("replaces the tag list", () => {
    const edited = applyEdit(aBook({ subjects: ["a"] }), {
      subjects: ["cozy"],
    });

    expect(edited.subjects).toEqual(["cozy"]);
  });

  it("replaces the genre list", () => {
    const edited = applyEdit(aBook({ genres: ["b"] }), { genres: ["Fantasy"] });

    expect(edited.genres).toEqual(["Fantasy"]);
  });

  it("empties a list given none", () => {
    expect(applyEdit(aBook({ genres: ["b"] }), { genres: [] }).genres).toEqual(
      [],
    );
  });

  it("returns the book unchanged for an empty edit", () => {
    const book = aBook({ subjects: ["a"], language: "en" });

    expect(applyEdit(book, {})).toEqual(book);
  });
});
