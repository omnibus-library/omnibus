import { describe, expect, it } from "vitest";
import { anExternalBook, aScanBook } from "../../testing/scanHandlers";
import {
  applyKey,
  byline,
  cleanIsbn,
  closeMatchCopy,
  confirmSubtitle,
  foundViaLine,
  isbnRejection,
  manualFallback,
  metaDetails,
  someIfFilled,
  stageFor,
  truncationNote,
} from "./checkIn";

describe("cleanIsbn", () => {
  it("drops separators and upper-cases the X check digit", () => {
    expect(cleanIsbn(" 978-0-13 468599-1 ")).toBe("9780134685991");
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

describe("stageFor", () => {
  const book = aScanBook();
  const online = anExternalBook();

  it("opens no screen for a book that is already owned", () => {
    expect(stageFor({ kind: "already_owned", book }, "1")).toBeNull();
  });

  it.each([
    ["in_library_unowned", false],
    ["on_wishlist", true],
  ] as const)("confirms a %s book, wishlisted=%s", (kind, wishlisted) => {
    expect(stageFor({ kind, book }, "9780134685991")).toEqual({
      kind: "confirm",
      book,
      isbn: "9780134685991",
      wishlisted,
    });
  });

  it("lists a close match's head and tail as one list", () => {
    const other = aScanBook({ uuid: "other" });

    expect(
      stageFor(
        { kind: "close_match", book, others: [other], scanned: online },
        "1",
      ),
    ).toEqual({ kind: "closeMatch", books: [book, other], scanned: online });
    expect(
      stageFor({ kind: "close_match", book, scanned: online }, "1"),
    ).toMatchObject({ books: [book] });
  });

  it("offers the chooser for a book found only online", () => {
    expect(stageFor({ kind: "not_in_library", online }, "1")).toEqual({
      kind: "choose",
      online,
    });
  });

  it("keeps the ISBN for an unresolved lookup", () => {
    expect(stageFor({ kind: "unresolved" }, "9780134685991")).toEqual({
      kind: "unresolved",
      isbn: "9780134685991",
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

  it("asks which of several, naming a scan or a picked edition", () => {
    expect(closeMatchCopy(true, "scan")).toMatchObject({
      heading: "Which one is this?",
      subtitle:
        "The ISBN you scanned isn't on any book in your library, but the title and author match these.",
      pick: "This one",
      decline: "None of these",
    });
    expect(closeMatchCopy(true, "search").subtitle).toMatch(
      /^That edition's ISBN/,
    );
  });
});

describe("confirmSubtitle", () => {
  it.each([
    [aScanBook({ has_files: true }), false, "digitally"],
    [aScanBook({ has_files: false, has_physical: true }), false, "another"],
    [
      aScanBook({ has_files: false, has_physical: false }),
      false,
      "without a file",
    ],
    [aScanBook(), true, "takes it off"],
  ])("words the holdings of %#", (book, wishlisted, fragment) => {
    expect(confirmSubtitle(book, wishlisted)).toContain(fragment);
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
  it("joins whichever facts the provider carried", () => {
    expect(metaDetails(anExternalBook())).toBe(
      "First published 2019 · Lantern Press · 320 pages",
    );
  });

  it("is null when it carried none", () => {
    expect(
      metaDetails(
        anExternalBook({
          first_publish_year: null,
          publisher: " ",
          pages: 0,
        }),
      ),
    ).toBeNull();
  });
});

describe("someIfFilled", () => {
  it("trims a note and drops a blank one", () => {
    expect(someIfFilled("  Paperback ")).toBe("Paperback");
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
  it("appends a digit and the ISBN-10 check digit", () => {
    expect(applyKey("97", "8")).toBe("978");
    expect(applyKey("080442957", "X")).toBe("080442957X");
  });

  it("tidies what was typed before appending", () => {
    expect(applyKey("978-0", "1")).toBe("97801");
  });

  it("pops the last character on backspace, and nothing from an empty entry", () => {
    expect(applyKey("9780", "⌫")).toBe("978");
    expect(applyKey("", "⌫")).toBe("");
  });

  it("stops at the thirteenth slot", () => {
    expect(applyKey("9780134685991", "7")).toBe("9780134685991");
    expect(applyKey("978013468599", "1")).toBe("9780134685991");
  });
});

describe("manualFallback", () => {
  it("returns to the lookup it came from and to the keypad from anywhere else", () => {
    expect(manualFallback({ kind: "lookup" })).toEqual({ kind: "lookup" });
    expect(manualFallback({ kind: "scan" })).toEqual({ kind: "entry" });
    expect(manualFallback({ kind: "entry" })).toEqual({ kind: "entry" });
  });
});
