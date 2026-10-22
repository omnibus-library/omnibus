import { describe, expect, it } from "vitest";
import { toBookDetail } from "../../api";
import { aWireBook } from "../../testing/wire";
import { detailRows, identifierRows, looksLikeIsbn } from "./identifiers";

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

    it("adds a saved ISBN-10 beside the ISBN-13", () => {
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

    it("replaces the row a saved ISBN-10 corrects", () => {
      const out = rows([ident("02", "0316769487")], null, "031625908X");

      expect(out.map((r) => [r.label, r.value])).toEqual([
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

describe("detailRows", () => {
  const book = (overrides: Parameters<typeof aWireBook>[0] = {}) =>
    toBookDetail(
      aWireBook({
        publisher: "Inkwell Press",
        language: "en",
        identifiers: [{ scheme: "15", value: "9780316769488" }],
        // Local noon, so the day reads the same in every zone.
        added_at: new Date(2024, 4, 1, 12).toISOString(),
        ...overrides,
      }),
    );
  const unset = (out: ReturnType<typeof detailRows>) =>
    out.flatMap((r) => ("unset" in r ? [[r.key, r.label]] : []));

  it("marks an unset publisher date language and isbn not set", () => {
    const out = detailRows(
      book({
        publisher: null,
        published: null,
        language: null,
        identifiers: [],
      }),
    );

    expect(unset(out)).toEqual([
      ["publisher", "Publisher"],
      ["published", "Published"],
      ["language", "Language"],
      ["isbn13", "ISBN"],
    ]);
    // The ISBN's slot is the first of the identifiers, after the language.
    expect(out.map((r) => r.label).slice(0, 7)).toEqual([
      "Title",
      "Author",
      "Publisher",
      "Published",
      "Language",
      "ISBN",
      "UUID",
    ]);
  });

  it("counts a placeholder publication date as unset", () => {
    const out = detailRows(book({ published: "0101-01-01T00:00:00+00:00" }));

    expect(unset(out)).toEqual([["published", "Published"]]);
  });

  it("lists what is set as values", () => {
    const out = detailRows(book({ published: "2021-03-01T00:00:00+00:00" }));

    expect(unset(out)).toEqual([]);
    expect(out.slice(0, 6)).toEqual([
      { key: "title", label: "Title", value: "Aurora Station, Vol. 1" },
      { key: "author", label: "Author", value: "Sora Inkwell" },
      { key: "publisher", label: "Publisher", value: "Inkwell Press" },
      { key: "published", label: "Published", value: "Mar 1st, 2021" },
      { key: "language", label: "Language", value: "en" },
      expect.objectContaining({ label: "ISBN-13", value: "9780316769488" }),
    ]);
  });

  it("lists the uuid and the date added", () => {
    const out = detailRows(book());
    const b = book();

    expect(out.slice(-2)).toEqual([
      { key: "uuid", label: "UUID", value: b.uuid },
      { key: "added", label: "Added", value: "May 1st, 2024" },
    ]);
  });

  it("leaves out the author and the date added when unknown", () => {
    const out = detailRows(book({ creators: [], added_at: null }));

    expect(out.map((r) => r.label)).not.toContain("Author");
    expect(out.map((r) => r.label)).not.toContain("Added");
    expect(out.at(-1)).toMatchObject({ label: "UUID" });
  });

  it("puts the ISBN ahead of the other identifiers", () => {
    const out = detailRows(
      book({
        identifiers: [
          { scheme: "goodreads", value: "12345" },
          { scheme: "15", value: "9780316769488" },
        ],
      }),
    );

    expect(out.map((r) => r.label).slice(5, 7)).toEqual([
      "ISBN-13",
      "Goodreads ID",
    ]);
  });

  it("keeps the ISBN unset marker when only other identifiers exist", () => {
    const out = detailRows(
      book({ identifiers: [{ scheme: "goodreads", value: "12345" }] }),
    );

    expect(unset(out)).toEqual([["isbn13", "ISBN"]]);
    expect(out.map((r) => r.label).slice(5, 7)).toEqual([
      "ISBN",
      "Goodreads ID",
    ]);
  });
});
