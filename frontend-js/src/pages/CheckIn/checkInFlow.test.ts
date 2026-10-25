import { describe, expect, it } from "vitest";
import { anExternalBook, aScanBook } from "../../testing/scanHandlers";
import {
  applyKey,
  byline,
  cleanIsbn,
  closeMatchCopy,
  confirmSubtitle,
  foundViaLine,
  heldOnlyByAWish,
  isbnRejection,
  manualFallback,
  metaDetails,
  offersWishlistEntry,
  someIfFilled,
  stageFor,
  truncationNote,
  wishlistRequestForBook,
} from "./checkInFlow";

describe("cleanIsbn", () => {
  it("drops separators from an ISBN", () => {
    expect(cleanIsbn(" 978-0-13 468599-1 ")).toBe("9780134685991");
  });

  it("upper-cases the X check digit", () => {
    expect(cleanIsbn("080442957x")).toBe("080442957X");
  });
});

describe("isbnRejection", () => {
  it.each(["9780134685991", "0134685997", "080442957X"])(
    "accepts %s",
    (isbn) => {
      expect(isbnRejection(isbn)).toBeNull();
    },
  );

  it.each(["", "123456789", "12345678901", "97801346859911"])(
    "asks for 10 or 13 digits when %j has the wrong length",
    (isbn) => {
      expect(isbnRejection(isbn)).toBe("Enter a 10- or 13-digit ISBN.");
    },
  );

  it.each([
    "01346859A7", // a letter in an ISBN-10
    "0X34685997", // an X before the check digit
    "978013468599X", // an X in an ISBN-13
  ])("refuses the characters in %s", (isbn) => {
    expect(isbnRejection(isbn)).toBe("ISBN contains invalid characters");
  });

  it.each(["9780134685992", "0134685998", "0804429570"])(
    "refuses the check digit of %s",
    (isbn) => {
      expect(isbnRejection(isbn)).toBe("ISBN has an invalid check digit");
    },
  );
});

describe("offersWishlistEntry", () => {
  it("offers the wishlist action for a wish-only book not yet on the reader's list", () => {
    const wishOnly = aScanBook({ has_files: false, has_physical: false });

    expect(offersWishlistEntry(wishOnly, false)).toBe(true);
    expect(offersWishlistEntry(wishOnly, true)).toBe(false);
    expect(offersWishlistEntry(aScanBook(), false)).toBe(false);
    expect(
      offersWishlistEntry(
        aScanBook({ has_files: false, has_physical: true }),
        false,
      ),
    ).toBe(false);
  });
});

describe("stageFor", () => {
  const book = aScanBook();
  const online = anExternalBook();

  it.each([
    ["in_library_unowned", false],
    ["on_wishlist", true],
  ] as const)("confirms a %s book, wishlisted=%s", (kind, wishlisted) => {
    expect(stageFor({ kind, book }, "9780134685991", "scan")).toEqual({
      kind: "confirm",
      book,
      isbn: "9780134685991",
      wishlisted,
      anotherWish: false,
      via: "scan",
    });
  });

  it("lists the head then the others of a close match", () => {
    const other = aScanBook({ uuid: "other" });

    expect(
      stageFor(
        { kind: "close_match", book, others: [other], scanned: online },
        "1",
        "scan",
      ),
    ).toEqual({
      kind: "closeMatch",
      books: [book, other],
      scanned: online,
      via: "scan",
    });
  });

  it("lists the head alone when a close match has no others", () => {
    expect(
      stageFor({ kind: "close_match", book, scanned: online }, "1", "isbn"),
    ).toMatchObject({ books: [book] });
  });

  it("offers the chooser for a book found only online", () => {
    expect(stageFor({ kind: "not_in_library", online }, "1", "scan")).toEqual({
      kind: "choose",
      online,
      via: "scan",
    });
  });

  it("keeps the ISBN for an unresolved lookup", () => {
    expect(stageFor({ kind: "unresolved" }, "9780134685991", "scan")).toEqual({
      kind: "unresolved",
      isbn: "9780134685991",
      via: "scan",
    });
  });
});

describe("foundViaLine", () => {
  it.each([
    ["isbn", "Entered ISBN 978"],
    ["scan", "Scanned ISBN 978"],
    ["search", "ISBN 978, from the edition you picked"],
  ] as const)("words %s", (via, line) => {
    expect(foundViaLine(via, "978")).toBe(line);
  });
});

describe("closeMatchCopy", () => {
  it("asks about one candidate", () => {
    expect(closeMatchCopy(false, "isbn")).toEqual({
      heading: "Is this the book?",
      subtitle:
        "The ISBN you entered isn't on any book in your library, but the title and author match this one.",
      pick: "Yes, that's it",
      decline: "No, different book",
    });
  });

  it("asks which one a scan matched", () => {
    expect(closeMatchCopy(true, "scan")).toMatchObject({
      heading: "Which one is this?",
      subtitle:
        "The ISBN you scanned isn't on any book in your library, but the title and author match these.",
      pick: "This one",
      decline: "None of these",
    });
  });

  it("names a picked edition when several match", () => {
    expect(closeMatchCopy(true, "search").subtitle).toMatch(
      /^That edition's ISBN/,
    );
  });
});

describe("confirmSubtitle", () => {
  it.each([
    [aScanBook({ has_files: true }), false, "digitally"],
    [aScanBook({ has_files: false, has_physical: true }), false, "print copy"],
    [aScanBook(), true, "takes it off"],
  ])("words the holdings of %#", (book, wishlisted, fragment) => {
    expect(confirmSubtitle(book, wishlisted, false, 1)).toContain(fragment);
  });

  it("says a book nobody holds is on another reader's wishlist", () => {
    const wishOnly = aScanBook({ has_files: false, has_physical: false });

    expect(confirmSubtitle(wishOnly, false, true, 1)).toBe(
      "Not in your library — it's on another reader's wishlist.",
    );
  });

  describe("a print copy", () => {
    const paperOnly = (
      filers: { user_id: number | null; name: string | null }[],
    ) =>
      aScanBook({ has_files: false, has_physical: true, copy_filers: filers });

    it("is the viewer's when they filed one", () => {
      const book = paperOnly([
        { user_id: 2, name: "Sam" },
        { user_id: 1, name: "Ada" },
      ]);

      expect(confirmSubtitle(book, false, false, 1)).toBe(
        "You already have a print copy of this one — this adds another.",
      );
    });

    it("names the first named filer when the viewer filed none", () => {
      const book = paperOnly([
        { user_id: null, name: null },
        { user_id: 2, name: "Sam" },
      ]);

      expect(confirmSubtitle(book, false, false, 1)).toBe(
        "Sam already has a print copy of this one — this adds yours.",
      );
    });

    it.each([
      ["no filers", []],
      ["only a deleted filer", [{ user_id: null, name: null }]],
    ])("is the household's with %s", (_case, filers) => {
      expect(confirmSubtitle(paperOnly(filers), false, false, 1)).toBe(
        "The household already has a print copy of this one — this adds yours.",
      );
    });

    it("does not guess who filed it while the viewer is unknown", () => {
      const book = paperOnly([{ user_id: 2, name: "Sam" }]);

      expect(confirmSubtitle(book, false, false, null)).toBe(
        "The household already has a print copy of this one — this adds yours.",
      );
    });
  });
});

describe("heldOnlyByAWish", () => {
  it("holds only for a book with no file and no copy", () => {
    const wishOnly = aScanBook({ has_files: false, has_physical: false });

    expect(heldOnlyByAWish(wishOnly)).toBe(true);
    expect(heldOnlyByAWish(aScanBook())).toBe(false);
    expect(
      heldOnlyByAWish(aScanBook({ has_files: false, has_physical: true })),
    ).toBe(false);
  });
});

describe("stageFor", () => {
  const wishOnly = aScanBook({ has_files: false, has_physical: false });

  it("blames another reader's wish for an unowned book nobody holds", () => {
    expect(
      stageFor({ kind: "in_library_unowned", book: wishOnly }, "9780", "isbn"),
    ).toMatchObject({ kind: "confirm", anotherWish: true });
  });

  it("does not blame anyone for a book with a file", () => {
    expect(
      stageFor(
        { kind: "in_library_unowned", book: aScanBook() },
        "9780",
        "isbn",
      ),
    ).toMatchObject({ kind: "confirm", anotherWish: false });
  });
});

describe("confirmSubtitle without a proven wish", () => {
  it("says a wish holds a fileless, copyless book picked from a list", () => {
    const wishOnly = aScanBook({ has_files: false, has_physical: false });

    expect(confirmSubtitle(wishOnly, false, false, 1)).toBe(
      "Not in your library — it's on a wishlist.",
    );
  });
});

describe("wishlistRequestForBook", () => {
  it("targets the existing book by uuid, stamped with the door it came through", () => {
    const book = aScanBook();

    expect(wishlistRequestForBook(book, "scan")).toEqual({
      book_uuid: book.uuid,
      source: "scan",
    });
  });
});

describe("byline", () => {
  it.each([
    [[], ""],
    [["A"], "A"],
    [["A", "B"], "A and B"],
    [["A", "B", "C"], "A, B and C"],
    [[" A ", "", "B"], "A and B"],
  ])("joins %j as %j", (authors, line) => {
    expect(byline(authors)).toBe(line);
  });
});

describe("metaDetails", () => {
  it("joins the edition facts the provider carried", () => {
    const meta = anExternalBook({
      first_publish_year: 2016,
      publisher: "Orbit",
      format: "Paperback",
      pages: 410,
      isbn13: "9780316229265",
    });

    expect(metaDetails(meta)).toBe(
      "First published 2016 · Orbit · Paperback · 410 pages · ISBN 9780316229265",
    );
  });

  it("skips absent facts without stray separators", () => {
    const meta = anExternalBook({
      first_publish_year: null,
      publisher: null,
      pages: null,
      format: "Paperback",
      isbn13: "9780316229265",
    });

    expect(metaDetails(meta)).toBe("Paperback · ISBN 9780316229265");
  });

  it("is null when it carried none", () => {
    expect(
      metaDetails(
        anExternalBook({
          first_publish_year: null,
          publisher: " ",
          format: " ",
          pages: 0,
          isbn13: "",
        }),
      ),
    ).toBeNull();
  });
});

describe("someIfFilled", () => {
  it("trims a note", () => {
    expect(someIfFilled("  Paperback ")).toBe("Paperback");
  });

  it("drops a blank note", () => {
    expect(someIfFilled("   ")).toBeUndefined();
  });
});

describe("truncationNote", () => {
  it("says how many of the matches are shown when some are hidden", () => {
    expect(truncationNote(5, 12)).toBe(
      "Showing 5 of 12 matches — add the author or more of the title.",
    );
  });

  it("says nothing when every match is shown", () => {
    expect(truncationNote(5, 5)).toBeNull();
  });
});

describe("applyKey", () => {
  it("appends a digit", () => {
    expect(applyKey("97", "8")).toBe("978");
  });

  it("appends the ISBN-10 check digit", () => {
    expect(applyKey("080442957", "X")).toBe("080442957X");
  });

  it("tidies what was typed before appending", () => {
    expect(applyKey("978-0", "1")).toBe("97801");
  });

  it("pops the last character on backspace", () => {
    expect(applyKey("9780", "⌫")).toBe("978");
  });

  it("pops nothing from an empty entry", () => {
    expect(applyKey("", "⌫")).toBe("");
  });

  it("stops at the thirteenth slot", () => {
    expect(applyKey("9780134685991", "7")).toBe("9780134685991");
    expect(applyKey("978013468599", "1")).toBe("9780134685991");
  });
});

describe("manualFallback", () => {
  it("returns to the lookup it came from", () => {
    expect(manualFallback({ kind: "lookup" })).toEqual({ kind: "lookup" });
  });

  it("returns to the keypad from anywhere else", () => {
    expect(manualFallback({ kind: "scan" })).toEqual({ kind: "entry" });
    expect(manualFallback({ kind: "entry" })).toEqual({ kind: "entry" });
  });
});
