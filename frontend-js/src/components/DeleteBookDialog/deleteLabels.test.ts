import { describe, expect, it } from "vitest";
import type { DeletionManifest } from "../../api";
import { chooseLabels, confirmLabels, losses } from "./deleteLabels";

const NO_IMPACT = {
  bookmarks: 0,
  highlights: 0,
  journal_entries: 0,
  listening_sessions: 0,
  ratings: 0,
  reading_sessions: 0,
  shelves: 0,
};

const file = (id: number, label: string | null = null) => ({
  id,
  format: "EPUB",
  label,
  filename: `book-${id}.epub`,
  sizeBytes: 1000,
  path: null,
});
const copy = (id: number) => ({
  id,
  filerId: null,
  filerName: null,
  checkedInAt: 0,
  isbn: null,
  note: null,
});

const manifest = (
  files: number[],
  copies: number[] = [],
  impact = NO_IMPACT,
): DeletionManifest => ({
  files: files.map((id) => file(id)),
  copies: copies.map(copy),
  impact,
});
const picking = (files: number[], copies: number[] = []) => ({
  files: new Set(files),
  copies: new Set(copies),
});

describe("losses", () => {
  it("counts each kind of reader data, singular or plural, skipping none", () => {
    expect(losses({ ...NO_IMPACT, highlights: 3, ratings: 1 })).toEqual([
      "3 highlights",
      "1 rating",
    ]);
    expect(losses(NO_IMPACT)).toEqual([]);
  });
});

describe("chooseLabels", () => {
  it("names the action, not a count, while nothing is picked", () => {
    expect(chooseLabels(manifest([1, 2]), 0).action).toBe("Delete files…");
    expect(chooseLabels(manifest([1, 2]), 1).action).toBe("Delete 1 file…");
    expect(chooseLabels(manifest([1, 2]), 2).action).toBe("Delete 2 files…");
  });

  it("calls rows items once a physical copy is among them", () => {
    const labels = chooseLabels(manifest([1], [9]), 2);
    expect(labels.action).toBe("Delete 2 items…");
    expect(labels.filesHead).toBe("FILES ON DISK");
    expect(labels.allPicked).toBe(true);
  });

  it("counts the files in the section head when there are no copies", () => {
    expect(chooseLabels(manifest([1]), 0).filesHead).toBe("1 FILE ON DISK");
    expect(chooseLabels(manifest([1, 2, 3]), 0).filesHead).toBe(
      "3 FILES ON DISK",
    );
  });
});

describe("confirmLabels", () => {
  it("offers to delete the record of a book with nothing on disk", () => {
    const labels = confirmLabels("Dune", manifest([]), picking([]));
    expect(labels).toMatchObject({
      heading: "Delete “Dune”?",
      action: "Delete record",
      empty: true,
    });
    expect(labels.copy).toContain("removes the library record only");
  });

  it("deletes a book that has one file by naming the book", () => {
    const labels = confirmLabels("Dune", manifest([1]), picking([1]));
    expect(labels.heading).toBe("Delete “Dune”?");
    expect(labels.action).toBe("Delete book");
    expect(labels.copy).toBe(
      "Every file for “Dune” will be deleted from disk, and the book will be removed from your library entirely.",
    );
  });

  it("deletes everything of a book with several files and copies, and lists the reader data lost", () => {
    const labels = confirmLabels(
      "Dune",
      manifest([1, 2], [9], { ...NO_IMPACT, highlights: 2 }),
      picking([1, 2], [9]),
    );
    expect(labels.heading).toBe("Delete all 3 items?");
    expect(labels.copy).toContain("its physical copies un-recorded");
    expect(labels.losses).toEqual(["2 highlights"]);
  });

  it("un-records a book that is only physical copies without touching disk", () => {
    const labels = confirmLabels("Dune", manifest([], [9]), picking([], [9]));
    expect(labels.copy).toContain("has no files on disk");
  });

  it("keeps the book for a partial delete and says what stays", () => {
    const labels = confirmLabels(
      "Dune",
      manifest([1, 2], [], { ...NO_IMPACT, highlights: 2 }),
      picking([1]),
    );
    expect(labels).toMatchObject({
      heading: "Delete 1 file?",
      action: "Delete file",
      losses: [],
    });
    expect(labels.copy).toBe(
      "“book-1.epub” will be deleted from disk and removed from this book. Dune stays in your library with its 1 remaining file.",
    );
  });

  it("only un-records when just copies are picked", () => {
    const labels = confirmLabels(
      "Dune",
      manifest([1], [8, 9]),
      picking([], [8]),
    );
    expect(labels.copy).toBe(
      "1 copy will be un-recorded — nothing is deleted from disk. Dune stays in your library with its 2 remaining items.",
    );
  });

  it("says both when files and copies are picked", () => {
    const labels = confirmLabels(
      "Dune",
      manifest([1, 2], [9]),
      picking([1], [9]),
    );
    expect(labels.copy).toContain(
      "1 file and 1 copy will be removed from this book — files deleted from disk, physical copies only un-recorded.",
    );
  });
});
