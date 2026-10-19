import { describe, expect, it } from "vitest";
import { type BookDetail, toBookDetail } from "./api";
import {
  ago,
  descriptionOverflows,
  durationLabel,
  facetQuery,
  formatDateShort,
  formatHm,
  formatInstantShort,
  formatLongDate,
  formatYear,
  homeKicker,
  initialOf,
  initialsFor,
  plateAuthor,
  recency,
  singleFacetValue,
  summaryIsSparse,
} from "./format";
import { aWireBook } from "./testing/wire";

const book: BookDetail = toBookDetail(
  aWireBook({
    title: "Alpha",
    creators: [{ name: "Ada Lovelace" }],
    series: null,
    published: "1843-10-01",
  }),
);

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
  const inSeries = { ...book, series: { name: "Aurora", index: "2" } };

  it("leads a series book with its name, position and year", () => {
    expect(homeKicker(inSeries, null)).toEqual({
      series: "Aurora",
      tail: " · Book 2 · 1843",
    });
  });

  it("adds how many of the series the library holds once it is known", () => {
    expect(homeKicker(inSeries, 3).tail).toBe(
      " · Book 2 · 3 in your library · 1843",
    );
  });

  it("leaves a series book with no index at its name and year", () => {
    const unindexed = { ...book, series: { name: "Aurora", index: null } };

    expect(homeKicker(unindexed, 3).tail).toBe(" · 1843");
  });

  it("leads a standalone with its first genre, then subject, then Book", () => {
    expect(
      homeKicker({ ...book, genres: ["Sci-fi"], subjects: ["Space"] }, null),
    ).toEqual({
      series: null,
      tail: "Sci-fi · standalone · 1843",
    });
    expect(homeKicker({ ...book, subjects: ["Space"] }, null).tail).toBe(
      "Space · standalone · 1843",
    );
    expect(homeKicker({ ...book, published: null }, null).tail).toBe(
      "Book · standalone",
    );
  });

  it("leaves out the year of calibre's placeholder date", () => {
    expect(homeKicker({ ...book, published: "0101-01-01" }, null).tail).toBe(
      "Book · standalone",
    );
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
    ["a full date", "2021-03-01", "Mar 1st, 2021"],
    ["an ISO timestamp", "2026-07-31T00:01:35Z", "Jul 31st, 2026"],
    ["the 11th to 13th", "2026-08-12", "Aug 12th, 2026"],
    ["a 2nd and a 23rd", "2026-08-22", "Aug 22nd, 2026"],
    ["a month alone", "2026-08", "Aug 2026"],
    ["a year alone", "2026", "2026"],
    ["a month out of range", "2026-13-05", "2026"],
    ["a day out of range", "2026-08-40", "Aug 2026"],
  ])("reads %s", (_condition, raw, shown) => {
    expect(formatDateShort(raw)).toBe(shown);
  });

  it.each([
    ["calibre's placeholder", "0101-01-01T00:00:00+00:00"],
    ["text", "unknown"],
  ])("returns null for %s", (_condition, raw) => {
    expect(formatDateShort(raw)).toBeNull();
  });
});

describe("formatInstantShort", () => {
  it("puts an instant on the calendar of the zone asked for", () => {
    expect(formatInstantShort("2026-09-08T03:36:00Z", "UTC")).toBe(
      "Sep 8th, 2026",
    );
    expect(formatInstantShort("2026-09-08T03:36:00Z", "America/Detroit")).toBe(
      "Sep 7th, 2026",
    );
  });

  it("reads the SQLite datetime shape as UTC", () => {
    expect(formatInstantShort("2024-01-02 03:04:05", "UTC")).toBe(
      "Jan 2nd, 2024",
    );
  });

  it("leaves a bare calendar date unshifted", () => {
    expect(formatInstantShort("2021-03-01", "Pacific/Kiritimati")).toBe(
      "Mar 1st, 2021",
    );
  });
});

describe("ago", () => {
  it.each([
    [30, "just now"],
    [60, "1 minute ago"],
    [59 * 60, "59 minutes ago"],
    [3 * 3600, "3 hours ago"],
    [86_400, "1 day ago"],
    [-5, "just now"],
  ])("reads %i seconds as %s", (secs, phrase) => {
    expect(ago(1_000_000 + secs, 1_000_000)).toBe(phrase);
  });
});

describe("recency", () => {
  it.each([
    [89, "just now"],
    [90, "1m ago"],
    [7200, "2h ago"],
    [86_400, "yesterday"],
    [172_800, "2d ago"],
  ])("reads %i seconds as %s", (secs, phrase) => {
    expect(recency(1_000_000 + secs, 1_000_000)).toBe(phrase);
  });
});

describe("formatHm", () => {
  it.each([
    [0, "0m"],
    [2459, "40m"],
    [3600, "1h 00m"],
    [23_460, "6h 31m"],
    [-5, "0m"],
  ])("reads %i seconds as %s", (secs, label) => {
    expect(formatHm(secs)).toBe(label);
  });
});

describe("durationLabel", () => {
  it.each([
    [0, "0m"],
    [2460, "41m"],
    [7200, "2h"],
    [7500, "2h 5m"],
    [-1, "0m"],
  ])("reads %i seconds as %s", (secs, label) => {
    expect(durationLabel(secs)).toBe(label);
  });
});

describe("formatLongDate", () => {
  it("puts a unix time on the calendar day of the zone asked for", () => {
    expect(formatLongDate(1_786_586_400, "UTC")).toBe("August 13, 2026");
    expect(formatLongDate(1_786_586_400, "America/Detroit")).toBe(
      "August 12, 2026",
    );
  });
});

describe("summaryIsSparse", () => {
  it("counts the words outside the tags against the 10-word minimum", () => {
    const words = (n: number) => `<p>${"word ".repeat(n)}</p>`;

    expect(summaryIsSparse(words(9))).toBe(true);
    expect(summaryIsSparse(words(10))).toBe(false);
    expect(summaryIsSparse("")).toBe(true);
  });
});
