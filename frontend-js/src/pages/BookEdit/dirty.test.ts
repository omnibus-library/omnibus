import { describe, expect, it } from "vitest";
import { formFromBook, type MetaForm } from "../../api";
import { anEditableWireBook } from "../../testing/metadataHandlers";
import { dirtyLabels, saveLabel } from "./dirty";

const BASE = formFromBook(anEditableWireBook());
const edit = (changes: Partial<MetaForm>): MetaForm => ({
  ...BASE,
  ...changes,
});

describe("dirtyLabels", () => {
  it("names nothing for an untouched form", () => {
    expect(dirtyLabels(BASE, edit({}))).toEqual([]);
  });

  it("names the edited fields in the form's order, not the order they were edited", () => {
    const values = edit({
      genres: [],
      title: "New",
      seriesIndex: "9",
      authors: ["A"],
    });

    expect(dirtyLabels(BASE, values)).toEqual([
      "Title",
      "Book #",
      "Authors",
      "Genres",
    ]);
  });

  it("ignores whitespace around the page count", () => {
    expect(dirtyLabels(BASE, edit({ printPages: " 320 " }))).toEqual([]);
    expect(dirtyLabels(BASE, edit({ printPages: "321" }))).toEqual([
      "Print Pages",
    ]);
  });
});

describe("saveLabel", () => {
  it.each([
    [false, 0, "Done"],
    [false, 1, "Save · 1 field"],
    [false, 3, "Save · 3 fields"],
    [true, 3, "Saving…"],
  ])("reads for saving=%s with %d dirty", (saving, count, label) => {
    expect(saveLabel(saving, count)).toBe(label);
  });

  it.each([
    [false, "Add to library"],
    [true, "Adding…"],
  ])("reads for a book being added with saving=%s", (saving, label) => {
    expect(saveLabel(saving, 3, true)).toBe(label);
  });
});
