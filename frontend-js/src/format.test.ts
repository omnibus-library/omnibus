import { describe, expect, it } from "vitest";
import type { BookDetail } from "./api";
import { descriptionOverflows, homeKicker, plateAuthor } from "./format";
import { aBook } from "./testing/books";

const book: BookDetail = {
  ...aBook({ title: "Alpha", authors: ["Ada Lovelace"], series: null }),
  description: null,
  published: "1843-10-01",
  genres: [],
  subjects: [],
};

describe("plateAuthor", () => {
  it.each([
    [["Ada Lovelace"], "LOVELACE"],
    [["Lovelace, Ada"], "LOVELACE"],
    [[], ""],
  ])("reads %j as %s", (authors, label) => {
    expect(plateAuthor(authors)).toBe(label);
  });
});

describe("homeKicker", () => {
  it("leads a series book with its position and year", () => {
    const inSeries = { ...book, series: { name: "Aurora", index: "2" } };

    expect(homeKicker(inSeries)).toBe("Aurora · Book 2 · 1843");
  });

  it("leads a standalone with its first genre, then subject, then Book", () => {
    expect(
      homeKicker({ ...book, genres: ["Sci-fi"], subjects: ["Space"] }),
    ).toBe("Sci-fi · standalone · 1843");
    expect(homeKicker({ ...book, subjects: ["Space"] })).toBe(
      "Space · standalone · 1843",
    );
    expect(homeKicker({ ...book, published: null })).toBe("Book · standalone");
  });
});

describe("descriptionOverflows", () => {
  it("counts words outside the tags against the 50-word clamp", () => {
    const words = (n: number) => `<p>${"word ".repeat(n)}</p>`;

    expect(descriptionOverflows(words(50))).toBe(false);
    expect(descriptionOverflows(words(51))).toBe(true);
  });
});
