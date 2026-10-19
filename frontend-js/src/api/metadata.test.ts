import { describe, expect, it } from "vitest";
import {
  editionRequest,
  fillMissing,
  formFromBook,
  inStableOrder,
  type MetaForm,
  MetaFormSchema,
  overridesFrom,
} from "../api";
import {
  anEditableWireBook,
  aProviderEdition,
} from "../testing/metadataHandlers";

const BASE = formFromBook(anEditableWireBook());
const edit = (changes: Partial<MetaForm>): MetaForm => ({
  ...BASE,
  ...changes,
});

describe("formFromBook", () => {
  it("reads a book into the form with a blank for each missing field", () => {
    const form = formFromBook(
      anEditableWireBook({
        publisher: null,
        print_pages: null,
        genres: undefined,
      }),
    );

    expect(form).toMatchObject({
      title: "Aurora Station, Vol. 1",
      publisher: "",
      printPages: "",
      authors: ["Sora Inkwell"],
      tags: ["space opera"],
      genres: [],
    });
  });
});

describe("MetaFormSchema", () => {
  it.each(["", "  ", "320", " 32 ", "1", "20000"])(
    "accepts %j as the page count",
    (printPages) => {
      expect(MetaFormSchema.safeParse(edit({ printPages })).success).toBe(true);
    },
  );

  it.each(["abc", "3.5", "-4", "3 2"])(
    "refuses %j as the page count",
    (printPages) => {
      const parsed = MetaFormSchema.safeParse(edit({ printPages }));

      expect(parsed.error?.issues[0]?.message).toBe(
        "Print page count must be a whole number.",
      );
    },
  );

  it.each(["0", "20001", "99999999999999999999"])(
    "refuses %j as the page count with the range message",
    (printPages) => {
      const parsed = MetaFormSchema.safeParse(edit({ printPages }));

      expect(parsed.error?.issues[0]?.message).toBe(
        "Print pages must be between 1 and 20000.",
      );
    },
  );
});

describe("overridesFrom", () => {
  it("is empty when nothing changed", () => {
    expect(overridesFrom(BASE, edit({}))).toEqual({});
  });

  it("sends only the changed fields under the API names", () => {
    expect(
      overridesFrom(BASE, edit({ title: "New", seriesIndex: "2" })),
    ).toEqual({
      title: "New",
      series_index: "2",
    });
  });

  it("sends a cleared text field as an empty string", () => {
    expect(overridesFrom(BASE, edit({ isbn13: "" }))).toEqual({ isbn13: "" });
  });

  it("sends authors as creators with the author role", () => {
    expect(overridesFrom(BASE, edit({ authors: ["A", "B"] }))).toEqual({
      creators: [
        { name: "A", role: "aut" },
        { name: "B", role: "aut" },
      ],
    });
  });

  it("sends a changed list even when it is now empty", () => {
    expect(overridesFrom(BASE, edit({ tags: ["a", "b"], genres: [] }))).toEqual(
      {
        subjects: ["a", "b"],
        genres: [],
      },
    );
  });

  it("sends the page count as a number only when it changed", () => {
    expect(overridesFrom(BASE, edit({ printPages: " 400 " }))).toEqual({
      print_pages: 400,
    });
    expect(overridesFrom(BASE, edit({ printPages: "320" }))).toEqual({});
  });

  it("leaves the page count alone when the field is blank", () => {
    expect(overridesFrom(BASE, edit({ printPages: "" }))).toEqual({});
  });
});

describe("editionRequest", () => {
  it("is null when every field is blank", () => {
    expect(editionRequest(" ", "", "\t")).toBeNull();
  });

  it("composes the free-text query from the filled fields", () => {
    expect(editionRequest(" Dune ", "Frank Herbert", "")).toEqual({
      query: "Dune Frank Herbert",
      title: "Dune",
      author: "Frank Herbert",
      isbn: undefined,
    });
  });

  it("asks for an ISBN alone", () => {
    expect(editionRequest("", "", "9780441013593")).toMatchObject({
      query: "",
      isbn: "9780441013593",
    });
  });
});

describe("inStableOrder", () => {
  const edition = (
    title: string,
    isbn13: string,
    source: "open_library" | "google_books" | "hardcover" = "open_library",
    more: Parameters<typeof aProviderEdition>[0] = {},
  ) =>
    aProviderEdition({
      title,
      isbn13,
      source,
      provider_ref: `${source}-${isbn13}`,
      ...more,
    });

  it("gives the same order however the providers answered", () => {
    const a = edition("Effective Java", "9780134685991");
    const b = edition("Effective Java", "9780134685991", "google_books");
    const c = edition("Dune", "9780441013593", "hardcover");

    const one = inStableOrder([a, b, c], "Effective Java");

    expect(inStableOrder([c, b, a], "Effective Java")).toEqual(one);
    expect(inStableOrder([b, a, c], "Effective Java")).toEqual(one);
  });

  it("moves nothing else when a provider drops out", () => {
    const ol = edition("Effective Java", "9780134685991");
    const gb = edition("Dune", "9780441013593", "google_books");
    const hc = edition("Neuromancer", "9780441569595", "hardcover");

    const full = inStableOrder([ol, gb, hc], "Effective Java");

    expect(inStableOrder([ol, hc], "Effective Java")).toEqual(
      full.filter((e) => e !== gb),
    );
  });

  it("leads with the titles that account for the whole query", () => {
    const sorted = inStableOrder(
      [
        edition(
          "A Study Guide for Ursula K. LeGuin's The Left Hand of Darkness",
          "9781410336088",
          "open_library",
          { authors: ["Gale"] },
        ),
        edition(
          "Gender under the Viking Age",
          "9798745605864",
          "open_library",
          { authors: ["Rusty Brient"] },
        ),
        edition("The Left Hand of Darkness", "9780441478125", "open_library", {
          authors: ["Ursula K. Le Guin"],
        }),
      ],
      "The Left Hand of Darkness Ursula K. Le Guin",
    );

    expect(sorted.map((e) => e.title)).toEqual([
      "The Left Hand of Darkness",
      "A Study Guide for Ursula K. LeGuin's The Left Hand of Darkness",
      "Gender under the Viking Age",
    ]);
  });

  it("orders by relevance with the unscored last", () => {
    const sorted = inStableOrder(
      [
        edition("Dune", "1"),
        edition("Dune Messiah", "2", "open_library", { relevance: 500 }),
        edition("Dune Study Guide", "3", "open_library", { relevance: 900 }),
      ],
      "Dune",
    );

    expect(sorted.map((e) => e.title)).toEqual([
      "Dune Study Guide",
      "Dune Messiah",
      "Dune",
    ]);
  });

  it("orders by the editions own fields for a blank query", () => {
    const sorted = inStableOrder(
      [edition("Zebra", "1", "google_books"), edition("Alpha", "2")],
      "   ",
    );

    expect(sorted[0]?.title).toBe("Alpha");
  });
});

describe("fillMissing", () => {
  const thin = aProviderEdition({
    isbn10: "0134685997",
    description: "From the list.",
    cover_url: "https://images.example.com/a.jpg",
    series: "Aurora Station",
    series_index: "1",
    pages: 320,
    genres: ["Drama"],
  });

  it("fills only what the full record lacks", () => {
    const full = aProviderEdition({
      publisher: "Other Press",
      description: "From the record.",
      isbn10: " ",
      cover_url: null,
      series: null,
      pages: null,
      genres: [],
    });

    expect(fillMissing(full, thin)).toMatchObject({
      publisher: "Other Press",
      description: "From the record.",
      isbn10: "0134685997",
      cover_url: "https://images.example.com/a.jpg",
      series: "Aurora Station",
      pages: 320,
      genres: ["Drama"],
    });
  });

  it("brings a book number across only inside the same series", () => {
    const same = fillMissing(
      aProviderEdition({ series: "Aurora Station" }),
      thin,
    );
    const other = fillMissing(
      aProviderEdition({ series: "Another Saga" }),
      thin,
    );

    expect(same.series_index).toBe("1");
    expect(other.series_index).toBeUndefined();
  });

  it("takes the missing fields from the list row when the record has none", () => {
    expect(
      fillMissing(aProviderEdition({ title: " ", authors: [] }), thin),
    ).toMatchObject({
      title: thin.title,
      authors: thin.authors,
    });
  });
});
