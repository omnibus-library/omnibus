import { describe, expect, it } from "vitest";
import { formFromBook, type ProviderSearchStatus } from "../../api";
import {
  anEditableWireBook,
  aProviderEdition,
} from "../../testing/metadataHandlers";
import {
  applyField,
  currentValue,
  differs,
  FIELDS,
  humanWait,
  isStaged,
  type MetadataField,
  sourceStatusText,
  sourceValue,
} from "./editionFields";

const source = (status: ProviderSearchStatus) => ({
  display_name: "Open Library",
  provider: "open_library" as const,
  status,
});

describe("humanWait", () => {
  it.each([
    [0, "1s"],
    [45, "45s"],
    [90, "90s"],
    [91, "2m"],
    [600, "10m"],
  ])("reads %d seconds as %s", (secs, text) => {
    expect(humanWait(secs)).toBe(text);
  });
});

describe("sourceStatusText", () => {
  it.each([
    [{ kind: "answered", count: 8 }, "8", false],
    [{ kind: "answered", count: 0 }, "nothing", false],
    [{ kind: "not_configured" }, "not set up", false],
    [{ kind: "failed", message: "timed out" }, "unavailable", true],
    [
      { kind: "throttled", retry_after_secs: 45 },
      "rate limited, skipping for 45s",
      true,
    ],
  ] satisfies [ProviderSearchStatus, string, boolean][])(
    "reads %j as %s",
    (status, text, problem) => {
      expect(sourceStatusText(source(status))).toMatchObject({ text, problem });
    },
  );

  it("carries the failure message as the detail", () => {
    expect(
      sourceStatusText(source({ kind: "failed", message: "timed out" })).detail,
    ).toBe("timed out");
  });
});

const BOOK = formFromBook(anEditableWireBook());
const field = (label: string): MetadataField => {
  const found = FIELDS.find((f) => f.label === label);
  if (!found) throw new Error(`no field ${label}`);
  return found;
};

describe("FIELDS", () => {
  it("slugs each row id from the label the edit form gives its input", () => {
    expect(FIELDS.map((f) => f.slug)).toEqual([
      "title",
      "author-s-",
      "publisher",
      "published",
      "series",
      "number-in-series",
      "isbn-13",
      "isbn-10",
      "print-pages",
      "genres",
      "description",
    ]);
  });

  it("leaves tags out so a provider vocabulary cannot overwrite the file tags", () => {
    expect(FIELDS.map((f) => f.key)).not.toContain("tags");
  });
});

describe("sourceValue and currentValue", () => {
  it("reads the same text on both sides with lists joined without blank entries", () => {
    const edition = aProviderEdition({ authors: ["A", " ", "B"], pages: 352 });

    expect(sourceValue(field("Author(s)"), edition)).toBe("A, B");
    expect(
      currentValue(field("Author(s)"), { ...BOOK, authors: ["A", "B"] }),
    ).toBe("A, B");
    expect(sourceValue(field("Print pages"), edition)).toBe("352");
    expect(sourceValue(field("Description"), edition)).toBe("");
  });
});

describe("differs", () => {
  it("is false when the source has nothing", () => {
    expect(differs(field("Description"), BOOK, aProviderEdition())).toBe(false);
  });

  it("is false when both sides agree", () => {
    const edition = aProviderEdition({ title: BOOK.title });

    expect(differs(field("Title"), BOOK, edition)).toBe(false);
  });

  it("is true when the sides differ", () => {
    const edition = aProviderEdition({ title: "Other" });

    expect(differs(field("Title"), BOOK, edition)).toBe(true);
  });
});

describe("isStaged", () => {
  it("is true only for a field that left the baseline", () => {
    const edited = { ...BOOK, title: "New", genres: [...BOOK.genres] };

    expect(isStaged(field("Title"), edited, BOOK)).toBe(true);
    expect(isStaged(field("Genres"), edited, BOOK)).toBe(false);
  });
});

describe("applyField", () => {
  it("offers nothing when the source has nothing", () => {
    expect(
      applyField(field("Publisher"), aProviderEdition({ publisher: " " })),
    ).toBeUndefined();
    expect(
      applyField(field("Genres"), aProviderEdition({ genres: [] })),
    ).toBeUndefined();
  });

  it("offers a list as a list", () => {
    const edition = aProviderEdition({ genres: ["Drama", " "] });

    expect(applyField(field("Genres"), edition)).toEqual(["Drama"]);
  });

  it("offers text trimmed", () => {
    const edition = aProviderEdition({ year: " 2022 " });

    expect(applyField(field("Published"), edition)).toBe("2022");
  });
});
