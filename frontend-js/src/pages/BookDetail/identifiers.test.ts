import { describe, expect, it } from "vitest";
import { identifierRows, looksLikeIsbn } from "./identifiers";

type Input = Parameters<typeof identifierRows>[0];

const ident = (scheme: string | null, value: string) => ({ scheme, value });

function rows(
  identifiers: Input["identifiers"],
  isbn13: string | null = null,
  isbn10: string | null = null,
) {
  return identifierRows({ identifiers, isbn13, isbn10 });
}

const labels = (out: ReturnType<typeof rows>) => out.map((r) => r.label);

describe("looksLikeIsbn", () => {
  it.each([["978-0-7564-0407-9"], ["0-316-76948-7"], ["080442957X"]])(
    "accepts %s",
    (value) => {
      expect(looksLikeIsbn(value)).toBe(true);
    },
  );

  it.each([
    ["a failing ISBN-10 check digit", "2100906924"],
    ["a failing ISBN-13 check digit", "9780756404078"],
    ["an X outside the last place", "X123456789"],
    ["the wrong length", "12345"],
  ])("rejects %s", (_condition, value) => {
    expect(looksLikeIsbn(value)).toBe(false);
  });
});

describe("identifierRows", () => {
  describe("labels", () => {
    it.each([
      ["an ONIX ISBN-13 code", ident("15", "9780316769488"), "ISBN-13"],
      ["an ONIX ISBN-10 code", ident("02", "0316769487"), "ISBN-10"],
      ["a source uuid", ident("uuid", "c0e51a66"), "Source UUID"],
      ["an unrecognised named scheme", ident("BNB", "GB1234"), "BNB"],
      [
        "a valid ISBN under an unknown scheme",
        ident("unknown", "978-0-7564-0407-9"),
        "ISBN",
      ],
      ["a failing checksum", ident("unknown", "2100906924"), "Identifier"],
      [
        "an unrecognised numeric scheme with an ISBN",
        ident("99", "9780316769488"),
        "ISBN",
      ],
      ["an unrecognised numeric scheme", ident("99", "xyz"), "Identifier"],
    ])("names %s", (_condition, input, label) => {
      expect(labels(rows([input]))).toEqual([label]);
    });
  });

  describe("deduping", () => {
    it("keeps one row for a value listed under several schemes", () => {
      const out = rows([
        ident("15", "9780316769488"),
        ident("ISBN", "9780316769488"),
      ]);

      expect(out.map((r) => [r.label, r.value])).toEqual([
        ["ISBN-13", "9780316769488"],
      ]);
    });

    it("prefers a known label over an inferred one", () => {
      expect(
        labels(
          rows([
            ident("unknown", "9780316769488"),
            ident("15", "9780316769488"),
          ]),
        ),
      ).toEqual(["ISBN-13"]);
    });

    it("keeps the first label on a tie", () => {
      expect(
        labels(
          rows([
            ident("ISBN", "9780316769488"),
            ident("isbn", "9780316769488"),
          ]),
        ),
      ).toEqual(["ISBN"]);
    });

    it("keeps distinct values in source order", () => {
      const out = rows([
        ident("15", "9780316769488"),
        ident("calibre", "412"),
        ident("uuid", "c0e51a66"),
      ]);

      expect(labels(out)).toEqual(["ISBN-13", "Calibre ID", "Source UUID"]);
    });

    it("drops a blank value", () => {
      expect(rows([ident("ISBN", "   "), ident(null, "")])).toEqual([]);
    });

    it("keeps two non-ISBN values that differ only by a hyphen", () => {
      expect(
        rows([ident("calibre", "foo-123"), ident("calibre", "foo123")]),
      ).toHaveLength(2);
    });

    it("gives every row a distinct key", () => {
      const out = rows([
        ident("ISBN", "111"),
        ident("ISBN", "222"),
        ident(null, "333"),
      ]);

      expect(new Set(out.map((r) => r.key)).size).toBe(3);
    });
  });

  describe("saved ISBNs", () => {
    it("adds an ISBN-13 the file never carried", () => {
      expect(rows([], "9780316769488").map((r) => [r.label, r.value])).toEqual([
        ["ISBN-13", "9780316769488"],
      ]);
    });

    it("replaces the row a saved ISBN-10 corrects", () => {
      const out = rows(
        [ident("02", "9780316259088")],
        "9780316259088",
        "031625908X",
      );

      expect(out.map((r) => [r.label, r.value])).toEqual([
        ["ISBN-13", "9780316259088"],
        ["ISBN-10", "031625908X"],
      ]);
    });

    it("does not repeat a saved ISBN the file already carries, hyphenated or not", () => {
      expect(
        rows([ident("ISBN", "978-0-13-468599-1")], "9780134685991"),
      ).toHaveLength(1);
    });

    it("keeps two distinct scanned ISBNs when one is the saved ISBN-13", () => {
      const out = rows(
        [ident("ISBN", "9780000000000"), ident("15", "9781111111112")],
        "9780000000000",
      );

      expect(out.map((r) => r.value)).toContain("9781111111112");
      expect(out).toHaveLength(2);
    });

    it("collapses a urn:isbn twin onto the saved row", () => {
      const out = rows(
        [
          ident("ISBN", "urn:isbn:9780134685991"),
          ident("15", "978-0-13-468599-1"),
        ],
        "9780134685991",
      );

      expect(out.map((r) => [r.label, r.value])).toEqual([
        ["ISBN-13", "9780134685991"],
      ]);
    });

    it("never takes a URL carrying the digits for the ISBN", () => {
      const out = rows(
        [ident("url", "https://example.com/book/9780134685991")],
        "9780134685991",
      );

      expect(out).toHaveLength(2);
    });

    it("lets a saved ISBN-13 correct a different scanned ISBN-13", () => {
      const out = rows([ident("15", "9780000000000")], "9780316259088");

      expect(out.map((r) => [r.label, r.value])).toEqual([
        ["ISBN-13", "9780316259088"],
      ]);
    });
  });
});
