import { describe, expect, it } from "vitest";
import { findCopyUrl } from "./findCopy";

describe("findCopyUrl", () => {
  it("uses the isbn when present", () => {
    expect(
      findCopyUrl({
        isbn13: " 9780441013593 ",
        title: "Dune",
        authors: ["Frank Herbert"],
      }),
    ).toBe("https://www.amazon.com/s?k=9780441013593");
  });

  it("falls back to title and author", () => {
    expect(
      findCopyUrl({
        isbn13: null,
        title: "Children of Time",
        authors: ["Adrian Tchaikovsky", "Ines Varga"],
      }),
    ).toBe(
      "https://www.amazon.com/s?k=Children%20of%20Time%20Adrian%20Tchaikovsky",
    );
  });

  it("searches the title alone for a book with no author", () => {
    expect(findCopyUrl({ title: "Piranesi", authors: [] })).toBe(
      "https://www.amazon.com/s?k=Piranesi",
    );
  });
});
