import { describe, expect, it } from "vitest";
import { formFromBook, type MetaForm } from "../../api";
import {
  anEditableWireBook,
  aProviderEdition,
} from "../../testing/metadataHandlers";
import {
  bestPerProvider,
  diffRows,
  fetchRequest,
  onePerProvider,
} from "./fetch";

describe("fetchRequest", () => {
  it.each([
    ["thirteen digits", "9780134685991", "9780134685991"],
    ["thirteen digits with hyphens", "978-0-13-468599-1", "9780134685991"],
    ["ten digits", "0134685997", "0134685997"],
    ["ten characters ending in X", "013468599x", "013468599X"],
  ])("asks by isbn for %s", (_shape, query, isbn) => {
    expect(fetchRequest(query, "Sora Inkwell")).toEqual({
      query: "",
      isbn,
    });
  });

  it("asks by title and the book's author otherwise", () => {
    expect(fetchRequest("Aurora Station", "Sora Inkwell")).toEqual({
      query: "Aurora Station Sora Inkwell",
      title: "Aurora Station",
      author: "Sora Inkwell",
    });
  });

  it("asks by title alone when the book has no author", () => {
    expect(fetchRequest(" Aurora Station ", "")).toEqual({
      query: "Aurora Station",
      title: "Aurora Station",
    });
  });

  it("treats a number that is not an ISBN as a title", () => {
    expect(fetchRequest("1984", "Orwell")).toMatchObject({ title: "1984" });
  });

  it("asks by author alone when the title is blank", () => {
    expect(fetchRequest("  ", "Sora Inkwell")).toEqual({
      query: "Sora Inkwell",
      author: "Sora Inkwell",
    });
  });

  it("returns null when title and author are blank", () => {
    expect(fetchRequest("  ", " ")).toBeNull();
  });
});

describe("onePerProvider", () => {
  it("keeps the first edition from each provider in order", () => {
    const [a, b, c, d] = [
      aProviderEdition({ source: "google_books", provider_ref: "g1" }),
      aProviderEdition({ source: "open_library", provider_ref: "o1" }),
      aProviderEdition({ source: "google_books", provider_ref: "g2" }),
      aProviderEdition({ source: "open_library", provider_ref: "o2" }),
    ] as const;

    expect(onePerProvider([a, b, c, d])).toEqual([a, b]);
  });

  it("keeps nothing from nothing", () => {
    expect(onePerProvider([])).toEqual([]);
  });
});

describe("bestPerProvider", () => {
  const messiah = aProviderEdition({
    provider_ref: "m",
    title: "Dune Messiah",
  });
  const dune = aProviderEdition({ provider_ref: "d", title: "Dune" });

  it("keeps the provider's own first edition when the search has no title", () => {
    const request = fetchRequest("", "Frank Herbert");
    if (!request) throw new Error("an author-only search is a request");

    expect(bestPerProvider([messiah, dune], request)).toEqual([messiah]);
  });

  it("keeps the best-ordered edition when the search has a title", () => {
    const request = fetchRequest("Dune", "Frank Herbert");
    if (!request) throw new Error("a titled search is a request");

    expect(bestPerProvider([messiah, dune], request)).toEqual([dune]);
  });
});

describe("diffRows", () => {
  const BASE = formFromBook(anEditableWireBook());
  const values = (changes: Partial<MetaForm> = {}): MetaForm => ({
    ...BASE,
    ...changes,
  });

  it("lists only fields the edition would change", () => {
    const edition = aProviderEdition({
      title: "Aurora Station: Volume One",
      // The same as the book has, so not a difference.
      publisher: "Lantern Press",
      isbn13: "9780134685991",
      authors: ["Sora Inkwell"],
      year: null,
      pages: null,
    });

    expect(diffRows(values(), edition).map((r) => r.field.label)).toEqual([
      "Title",
    ]);
  });

  it("checks a row that fills an empty field", () => {
    const edition = aProviderEdition({ publisher: "Lantern Press" });

    const [row] = diffRows(values({ publisher: "" }), edition).filter(
      (r) => r.field.label === "Publisher",
    );

    expect(row).toMatchObject({
      before: "",
      after: "Lantern Press",
      checked: true,
    });
  });

  it("leaves a row that overwrites unchecked", () => {
    const edition = aProviderEdition({ title: "Aurora Station: Volume One" });

    const [row] = diffRows(values(), edition).filter(
      (r) => r.field.label === "Title",
    );

    expect(row).toMatchObject({
      before: "Aurora Station, Vol. 1",
      after: "Aurora Station: Volume One",
      checked: false,
    });
  });

  it("measures against what the form holds now, edits included", () => {
    const edition = aProviderEdition({ title: "Aurora Station: Volume One" });

    expect(
      diffRows(values({ title: "Aurora Station: Volume One" }), edition).map(
        (r) => r.field.label,
      ),
    ).not.toContain("Title");
  });
});
