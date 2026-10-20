import { afterEach, describe, expect, it, vi } from "vitest";
import { type BookDetail, toBookDetail } from "./api";
import {
  ago,
  bookCount,
  capitalize,
  descriptionOverflows,
  durationLabel,
  facetQuery,
  fileSize,
  formatDateShort,
  formatHm,
  formatInstantShort,
  formatLongDate,
  formatMonthYear,
  formatUtcDay,
  formatUtcTimestamp,
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

  it.each([
    ["scan", "a scan"],
    ["detail", "this page"],
    ["manual", "an ISBN you entered"],
    ["search", "a title search"],
  ] as const)("names a wishlist entry added from a %s", (source, phrase) => {
    expect(homeKicker(inSeries, 3, { addedAt: 1_760_000_000, source })).toEqual(
      {
        series: null,
        tail: `On your wishlist · added from ${phrase}`,
      },
    );
  });
});

describe("fileSize", () => {
  it.each([
    [0, null],
    [-5, null],
    [512, "512 B"],
    [1_500, "1.5 KB"],
    [3_100_000, "3.1 MB"],
    [2_400_000_000, "2.4 GB"],
  ])("sizes %i bytes as %s", (bytes, label) => {
    expect(fileSize(bytes)).toBe(label);
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

describe("bookCount", () => {
  it.each([
    [0, "0 books"],
    [1, "1 book"],
    [2, "2 books"],
  ])("counts %i as %s", (n, words) => {
    expect(bookCount(n)).toBe(words);
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

describe("formatMonthYear", () => {
  it.each([
    ["2016-05-02", "May 2016"],
    ["2016-05-02T21:00:00+00:00", "May 2016"],
    ["2016", "2016"],
    ["0101-01-01T00:00:00+00:00", null],
    ["", null],
  ])("reads %j as %j", (raw, label) => {
    expect(formatMonthYear(raw)).toBe(label);
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
    ["a 1st, a 3rd and an 11th", "2026-08-11", "Aug 11th, 2026"],
    ["a 3rd", "2026-08-03", "Aug 3rd, 2026"],
    ["a 13th", "2026-08-13", "Aug 13th, 2026"],
    ["a day past the month's end", "2016-05-32", "May 2016"],
    ["an offset timestamp", "2016-05-02T21:00:00+00:00", "May 2nd, 2016"],
    ["a SQLite datetime", "2024-01-02 03:04:05", "Jan 2nd, 2024"],
    ["the earliest real year", "0102-01-01", "Jan 1st, 102"],
  ])("reads %s", (_condition, raw, shown) => {
    expect(formatDateShort(raw)).toBe(shown);
  });

  it.each([
    ["calibre's placeholder", "0101-01-01T00:00:00+00:00"],
    ["text", "unknown"],
    ["nothing", ""],
    ["year one", "0001-01-01"],
  ])("returns null for %s", (_condition, raw) => {
    expect(formatDateShort(raw)).toBeNull();
  });
});

describe("formatInstantShort", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cuts an instant on the browser's local day by default", () => {
    vi.stubEnv("TZ", "America/Detroit");

    expect(formatInstantShort("2026-09-08T03:36:00Z")).toBe("Sep 7th, 2026");
    expect(formatInstantShort("2026-09-08 03:36:00")).toBe("Sep 7th, 2026");
  });

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

describe("formatUtcTimestamp", () => {
  it.each([
    [1_700_000_000, "2023-11-14 22:13:20 UTC"],
    [0, "1970-01-01 00:00:00 UTC"],
    [-1, "1969-12-31 23:59:59 UTC"],
  ])("writes %i unix seconds as %s", (secs, text) => {
    expect(formatUtcTimestamp(secs)).toBe(text);
  });
});

describe("formatUtcDay", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [1_700_000_000, "Nov 14, 2023"],
    [0, "Jan 1, 1970"],
    [1_704_067_200, "Jan 1, 2024"],
    [1_704_067_199, "Dec 31, 2023"],
    [-1, "Dec 31, 1969"],
  ])("writes %i unix seconds as %s", (secs, text) => {
    expect(formatUtcDay(secs)).toBe(text);
  });

  it("names the UTC day however far the runner's zone is ahead", () => {
    vi.stubEnv("TZ", "Pacific/Kiritimati");

    expect(formatUtcDay(1_704_067_199)).toBe("Dec 31, 2023");
  });
});

describe("capitalize", () => {
  it("upper-cases the first letter only", () => {
    expect(capitalize("library scan")).toBe("Library scan");
  });

  it("leaves an empty string empty", () => {
    expect(capitalize("")).toBe("");
  });
});
