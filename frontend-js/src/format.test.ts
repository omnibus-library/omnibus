import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookDetail } from "./api";
import {
  descriptionOverflows,
  facetQuery,
  formatDateShort,
  formatInstantShort,
  formatYear,
  homeKicker,
  initialOf,
  initialsFor,
  plateAuthor,
  singleFacetValue,
} from "./format";
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

describe("initialsFor", () => {
  it("returns the first two letters of a single name", () => {
    expect(initialsFor("ada")).toBe("AD");
  });

  it("returns the first letter of each of the first two names", () => {
    expect(initialsFor("Ada King Lovelace")).toBe("AK");
  });

  it.each([
    ["dots", "ada.lovelace"],
    ["underscores", "ada_lovelace"],
    ["hyphens", "ada-lovelace"],
  ])("splits names on %s", (_separator, name) => {
    expect(initialsFor(name)).toBe("AL");
  });

  it("returns a question mark for an empty name", () => {
    expect(initialsFor("  ")).toBe("?");
  });

  it("keeps an emoji whole", () => {
    expect(initialsFor("😀 Bob")).toBe("😀B");
  });
});

describe("initialOf", () => {
  it("returns the first character uppercased", () => {
    expect(initialOf("dune")).toBe("D");
  });

  it("keeps an emoji whole", () => {
    expect(initialOf("😀 Bob")).toBe("😀");
  });

  it("returns a question mark for an empty name", () => {
    expect(initialOf("")).toBe("?");
  });
});

describe("descriptionOverflows", () => {
  it("counts words outside the tags against the 50-word clamp", () => {
    const words = (n: number) => `<p>${"word ".repeat(n)}</p>`;

    expect(descriptionOverflows(words(50))).toBe(false);
    expect(descriptionOverflows(words(51))).toBe(true);
  });
});

describe("facetQuery", () => {
  it("leaves a single word bare", () => {
    expect(facetQuery("tag", " fantasy ")).toBe("tag:fantasy");
  });

  it("quotes a multi-word name", () => {
    expect(facetQuery("genre", "Dark academia")).toBe('genre:"Dark academia"');
  });

  it("doubles an embedded quote", () => {
    expect(facetQuery("tag", 'say"what')).toBe('tag:"say""what"');
  });
});

describe("singleFacetValue", () => {
  it("reads the name back from a quoted facet", () => {
    expect(singleFacetValue('tag:"Say ""hi"""')).toBe('Say "hi"');
  });

  it.each([
    ["free text", "dune messiah"],
    ["a facet followed by more text", 'tag:"Sci-fi" dune'],
  ])("returns null for %s", (_case, query) => {
    expect(singleFacetValue(query)).toBeNull();
  });
});

describe("formatYear", () => {
  it("returns the year of a full date", () => {
    expect(formatYear("2021-03-01T00:00:00+00:00")).toBe("2021");
  });

  it("returns null for calibre's 0101 placeholder", () => {
    expect(formatYear("0101")).toBeNull();
  });
});

describe("formatDateShort", () => {
  it.each([
    ["2016-05-02T21:00:00+00:00", "May 2nd, 2016"],
    ["2024-01-02 03:04:05", "Jan 2nd, 2024"],
    ["2026-08-01", "Aug 1st, 2026"],
    ["2026-08-03", "Aug 3rd, 2026"],
    ["2026-08-11", "Aug 11th, 2026"],
    ["2026-08-12", "Aug 12th, 2026"],
    ["2026-08-13", "Aug 13th, 2026"],
    ["2026-08-22", "Aug 22nd, 2026"],
    ["2016-05", "May 2016"],
    ["2016-05-32", "May 2016"],
    ["2016", "2016"],
    ["0102-01-01", "Jan 1st, 102"],
  ])("reads %s as %s", (raw, shown) => {
    expect(formatDateShort(raw)).toBe(shown);
  });

  it.each(["", "circa 1850", "0101-01-01T00:00:00+00:00", "0001-01-01"])(
    "reads %j as no date",
    (raw) => {
      expect(formatDateShort(raw)).toBe("—");
    },
  );
});

describe("formatInstantShort", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cuts an instant on the browser's local day", () => {
    vi.stubEnv("TZ", "America/Detroit");

    expect(formatInstantShort("2026-09-08T03:36:00Z")).toBe("Sep 7th, 2026");
    expect(formatInstantShort("2026-09-08 03:36:00")).toBe("Sep 7th, 2026");
  });

  it("leaves a bare date and the missing-date sentinel to formatDateShort", () => {
    expect(formatInstantShort("2016-05-02")).toBe("May 2nd, 2016");
    expect(formatInstantShort("0101-01-01T05:00:00Z")).toBe("—");
    expect(formatInstantShort("")).toBe("—");
  });
});
