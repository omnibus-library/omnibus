import { describe, expect, it } from "vitest";
import { formFromBook } from "../../api";
import type { ProviderSearchStatus } from "../../api/generated/schemas";
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

  it("carries a failure's own message as the detail", () => {
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
  it("names each row's test id as the edit form names its input, without the prefix", () => {
    expect(FIELDS.map((f) => f.slug)).toEqual([
      "title",
      "author-s-",
      "publisher",
      "published",
      "series",
      "book--",
      "isbn-13",
      "isbn-10",
      "print-pages",
      "genres",
      "description",
    ]);
  });

  it("leaves tags out, since a provider's vocabulary would overwrite the file's own", () => {
    expect(FIELDS.map((f) => f.key)).not.toContain("tags");
  });
});

describe("sourceValue and currentValue", () => {
  it("read the same text on both sides, lists joined without their blank entries", () => {
    const edition = aProviderEdition({ authors: ["A", " ", "B"], pages: 352 });

    expect(sourceValue(field("Author(s)"), edition)).toBe("A, B");
    expect(
      currentValue(field("Author(s)"), { ...BOOK, authors: ["A", "B"] }),
    ).toBe("A, B");
    expect(sourceValue(field("Print Pages"), edition)).toBe("352");
    expect(sourceValue(field("Description"), edition)).toBe("");
  });
});

describe("differs", () => {
  it("is false when the source has nothing, so a gap is never a difference", () => {
    expect(differs(field("Description"), BOOK, aProviderEdition())).toBe(false);
  });

  it("is false when both sides agree and true when they do not", () => {
    const edition = aProviderEdition({ title: BOOK.title });

    expect(differs(field("Title"), BOOK, edition)).toBe(false);
    expect(differs(field("Title"), BOOK, { ...edition, title: "Other" })).toBe(
      true,
    );
  });
});

describe("isStaged", () => {
  it("is true only for a field that left the baseline, however it got there", () => {
    const edited = { ...BOOK, title: "New", genres: [...BOOK.genres] };

    expect(isStaged(field("Title"), edited, BOOK)).toBe(true);
    expect(isStaged(field("Genres"), edited, BOOK)).toBe(false);
  });
});

describe("applyField", () => {
  it("offers nothing when the source has nothing, so a copy never blanks a value", () => {
    expect(
      applyField(field("Publisher"), aProviderEdition({ publisher: " " })),
    ).toBeUndefined();
    expect(
      applyField(field("Genres"), aProviderEdition({ genres: [] })),
    ).toBeUndefined();
  });

  it("offers a list as a list and text trimmed", () => {
    const edition = aProviderEdition({
      genres: ["Drama", " "],
      year: " 2022 ",
    });

    expect(applyField(field("Genres"), edition)).toEqual(["Drama"]);
    expect(applyField(field("Published"), edition)).toBe("2022");
  });
});
