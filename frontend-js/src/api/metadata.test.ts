import { describe, expect, it } from "vitest";
import {
  formFromBook,
  type MetaForm,
  MetaFormSchema,
  overridesFrom,
} from "../api";
import { anEditableWireBook } from "../testing/metadataHandlers";

const BASE = formFromBook(anEditableWireBook());
const edit = (changes: Partial<MetaForm>): MetaForm => ({
  ...BASE,
  ...changes,
});

describe("formFromBook", () => {
  it("reads a book's fields and leaves a missing one blank", () => {
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
  it.each(["", "  ", "320", " 32 "])(
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
});

describe("overridesFrom", () => {
  it("is empty when nothing changed", () => {
    expect(overridesFrom(BASE, edit({}))).toEqual({});
  });

  it("sends only the fields that changed, text keyed as the API names it", () => {
    expect(
      overridesFrom(BASE, edit({ title: "New", seriesIndex: "2" })),
    ).toEqual({
      title: "New",
      series_index: "2",
    });
  });

  it("sends a cleared text field as an empty string, which clears the override", () => {
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

  it("sends a list that changed, even to empty", () => {
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
