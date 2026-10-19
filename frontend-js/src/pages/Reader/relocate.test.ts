import { describe, expect, it } from "vitest";
import type { TocEntry } from "./epubGlue";
import {
  applyGlueStatus,
  clearedByRelocate,
  formatAmbientPage,
  formatContentsProgress,
  formatProgressLabels,
  formatTitleSub,
  NO_LOCATION,
  relocateWrite,
  resolveChapterPosition,
} from "./relocate";

const entry = (label: string): TocEntry => ({
  label,
  href: `${label}.xhtml`,
  level: 0,
});

const titled = (chapterTitle: string, chapter = 0, totalChapters = 0) => ({
  chapter,
  totalChapters,
  chapterTitle,
});

describe("applyGlueStatus", () => {
  it("keeps failed over a late nav-error", () => {
    expect(applyGlueStatus("failed", "nav-error")).toBe("failed");
  });

  it("reads a nav-error as a notice over a ready page", () => {
    expect(applyGlueStatus("ready", "nav-error")).toBe("navFailed");
  });

  it.each([
    ["loading", "ready", "ready"],
    ["ready", "error", "failed"],
    ["ready", "loading", "loading"],
    ["ready", "something-new", "loading"],
  ] as const)("maps %s plus %s to %s", (current, state, expected) => {
    expect(applyGlueStatus(current, state)).toBe(expected);
  });
});

describe("clearedByRelocate", () => {
  it.each([
    ["loading", true],
    ["navFailed", true],
    ["failed", false],
    ["ready", false],
  ] as const)("reads %s as %s", (status, expected) => {
    expect(clearedByRelocate(status)).toBe(expected);
  });
});

describe("relocateWrite", () => {
  it("posts a moved position", () => {
    expect(relocateWrite("a", false, null, false)).toEqual({
      post: "a",
      lastPosted: "a",
      hold: false,
    });
  });

  it("skips an echo, however far it is from the last post", () => {
    expect(relocateWrite("b", true, "a", false).post).toBeNull();
  });

  it("skips a position that was already posted", () => {
    expect(relocateWrite("a", false, "a", false).post).toBeNull();
  });

  it("skips a report with no cfi", () => {
    expect(relocateWrite(null, false, "a", false).post).toBeNull();
  });

  it("swallows the held landing, counts it as posted and then writes movement", () => {
    const held = relocateWrite("a", false, null, true);
    expect(held).toEqual({ post: null, lastPosted: "a", hold: false });
    expect(relocateWrite("b", false, held.lastPosted, held.hold).post).toBe(
      "b",
    );
  });

  it("keeps the hold through an echo", () => {
    expect(relocateWrite("a", true, null, true).hold).toBe(true);
  });
});

describe("resolveChapterPosition", () => {
  const toc = [entry("Cover"), entry("Dedication"), entry("Chapter One")];

  it("matches the toc array position when the title resolves", () => {
    expect(resolveChapterPosition(toc, titled("Chapter One"), 1)).toEqual([
      3, 3,
    ]);
  });

  it("carries the previous chapter when the title is empty or unmatched", () => {
    expect(resolveChapterPosition(toc, titled(""), 2)).toEqual([2, 3]);
    expect(resolveChapterPosition(toc, titled("Interlude"), 2)).toEqual([2, 3]);
  });

  it("lets a matched title move backward", () => {
    expect(resolveChapterPosition(toc, titled("Dedication"), 3)).toEqual([
      2, 3,
    ]);
  });

  it("floors the first chapter at one", () => {
    expect(resolveChapterPosition(toc, titled(""), 0)).toEqual([1, 3]);
    expect(resolveChapterPosition([], titled("", 0, 318), 0)).toEqual([1, 318]);
  });

  it("takes the glue's pair before the toc has loaded", () => {
    expect(resolveChapterPosition([], titled("", 4, 12), 3)).toEqual([4, 12]);
  });

  it("leaves an unknown total at zero", () => {
    expect(resolveChapterPosition([], titled(""), 0)).toEqual([0, 0]);
  });
});

describe("format", () => {
  const paged = { ...NO_LOCATION, page: 42, totalPages: 300, pct: 14 };

  it("labels nothing before the first relocate", () => {
    expect(formatProgressLabels(NO_LOCATION)).toEqual({
      page: "",
      chapter: "",
    });
    expect(formatAmbientPage(NO_LOCATION)).toBe("");
    expect(formatTitleSub(NO_LOCATION)).toBe("");
    expect(formatContentsProgress(NO_LOCATION)).toBe("");
  });

  it("labels the page and chapter, with the non-breaking spaces and middots exact", () => {
    expect(
      formatProgressLabels({ ...paged, chapter: 3, totalChapters: 24 }),
    ).toEqual({
      page: "p. 42 of 300 · 14%",
      chapter: "Ch 3 of 24",
    });
  });

  it("falls back to the percent alone when the page total is unknown", () => {
    expect(formatProgressLabels({ ...NO_LOCATION, pct: 7 }).page).toBe("7%");
  });

  it("marks an approximate percent with a tilde everywhere it shows", () => {
    const loc = { ...paged, chapter: 2, pctApprox: true };

    expect(formatProgressLabels(loc).page).toBe("p. 42 of 300 · ~14%");
    expect(formatTitleSub(loc)).toBe("Ch. 2 · ~14%");
    expect(formatContentsProgress(loc)).toBe("42 / 300 · ~14%");
    expect(
      formatAmbientPage({ ...NO_LOCATION, pct: 47, pctApprox: true }),
    ).toBe("~47%");
  });

  it("shows the bare page number in the ambient footer when paginated", () => {
    expect(formatAmbientPage({ ...paged, page: 142 })).toBe("142");
    expect(formatAmbientPage({ ...NO_LOCATION, pct: 47 })).toBe("47%");
  });

  it("builds the title sub-line from the chapter, else the percent", () => {
    expect(formatTitleSub({ ...NO_LOCATION, chapter: 14, pct: 68 })).toBe(
      "Ch. 14 · 68%",
    );
    expect(formatTitleSub({ ...NO_LOCATION, pct: 68 })).toBe("68%");
  });

  it("builds the contents progress line", () => {
    expect(
      formatContentsProgress({
        ...NO_LOCATION,
        page: 184,
        totalPages: 272,
        pct: 68,
      }),
    ).toBe("184 / 272 · 68%");
  });

  it("never renders a stalled page figure across a chapter boundary", () => {
    const before = formatProgressLabels({
      ...NO_LOCATION,
      page: 22,
      totalPages: 22,
      pct: 40,
    });
    const after = formatProgressLabels({
      ...NO_LOCATION,
      page: 1,
      totalPages: 8,
      pct: 41,
    });

    expect(before.page).toBe("p. 22 of 22 · 40%");
    expect(after.page).toBe("p. 1 of 8 · 41%");
  });
});
