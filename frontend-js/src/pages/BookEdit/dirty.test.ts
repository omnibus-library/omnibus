import { describe, expect, it } from "vitest";
import { formFromBook, type MetaForm } from "../../api";
import { anEditableWireBook } from "../../testing/metadataHandlers";
import { dirtyLabels, leavePrompt, saveLabel, unsavedSummary } from "./dirty";

const BASE = formFromBook(anEditableWireBook());
const edit = (changes: Partial<MetaForm>): MetaForm => ({
  ...BASE,
  ...changes,
});

describe("dirtyLabels", () => {
  it("names nothing for an untouched form", () => {
    expect(dirtyLabels(BASE, edit({}))).toEqual([]);
  });

  it("names the edited fields in form order", () => {
    const values = edit({
      genres: [],
      title: "New",
      seriesIndex: "9",
      authors: ["A"],
    });

    expect(dirtyLabels(BASE, values)).toEqual([
      "Title",
      "Number in series",
      "Authors",
      "Genres",
    ]);
  });

  it("ignores whitespace around the page count", () => {
    expect(dirtyLabels(BASE, edit({ printPages: " 320 " }))).toEqual([]);
    expect(dirtyLabels(BASE, edit({ printPages: "321" }))).toEqual([
      "Print pages",
    ]);
  });
});

describe("saveLabel", () => {
  it.each([
    [false, "Add to library"],
    [true, "Adding…"],
  ])("reads for a book being added with saving=%s", (saving, label) => {
    expect(saveLabel(saving)).toBe(label);
  });
});

describe("unsavedSummary", () => {
  it("says no changes", () => {
    expect(unsavedSummary(0)).toBe("No changes");
  });

  it("counts one change", () => {
    expect(unsavedSummary(1)).toBe("1 unsaved change");
  });

  it("counts several changes", () => {
    expect(unsavedSummary(3)).toBe("3 unsaved changes");
  });
});

describe("leavePrompt", () => {
  it("asks about one change", () => {
    expect(leavePrompt(1)).toBe("Save your change before closing?");
  });

  it("asks about several changes", () => {
    expect(leavePrompt(2)).toBe("Save your 2 changes before closing?");
  });
});
