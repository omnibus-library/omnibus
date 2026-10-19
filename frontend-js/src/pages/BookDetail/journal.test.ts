import { describe, expect, it } from "vitest";
import { journalExcerpt, marqueeJournalKicker } from "./journal";

describe("marqueeJournalKicker", () => {
  it.each([
    [1, 1, 0, "1 entry from 1 reader"],
    [4, 2, 0, "4 entries from 2 readers"],
    [2, 1, 1, "2 entries from 1 reader · 1 draft"],
    [2, 1, 3, "2 entries from 1 reader · 3 drafts"],
    [0, 1, 2, "0 entries from 1 reader · 2 drafts"],
    [0, 0, 0, "No entries yet"],
  ])(
    "counts %i entries, %i readers and %i drafts",
    (published, readers, drafts, kicker) => {
      expect(marqueeJournalKicker(published, readers, drafts)).toBe(kicker);
    },
  );
});

describe("journalExcerpt", () => {
  it("takes the first non-empty line and strips its markup", () => {
    expect(journalExcerpt("\n\n## **A held** breath\nsecond line")).toBe(
      "A held breath",
    );
  });

  it("masks a spoiler span so it never reaches the row", () => {
    expect(journalExcerpt("she ||dies|| in chapter four")).toBe(
      "she ███ in chapter four",
    );
  });

  it("drops a list marker but keeps a dash inside the line", () => {
    expect(journalExcerpt("- first - second")).toBe("first - second");
  });

  it("returns nothing for a blank body", () => {
    expect(journalExcerpt("  \n\n")).toBe("");
  });

  it("cuts at 170 characters with an ellipsis, and not before", () => {
    expect(journalExcerpt("x".repeat(170))).toBe("x".repeat(170));
    expect(journalExcerpt("x".repeat(210))).toBe(`${"x".repeat(170)}…`);
  });

  it("counts a character outside the BMP once", () => {
    expect(journalExcerpt("😀".repeat(171))).toBe(`${"😀".repeat(170)}…`);
  });
});
