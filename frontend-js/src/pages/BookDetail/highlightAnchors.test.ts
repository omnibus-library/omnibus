import { describe, expect, it } from "vitest";
import {
  highlightLocator,
  pdfAnchorPage,
  readerDeepLink,
} from "./highlightAnchors";
import type { Chapter } from "./readout";

function toc(...entries: [string, number][]): Chapter[] {
  return entries.map(([title, spineIndex]) => ({
    title,
    percent: 0,
    spineIndex,
    anchorPath: null,
  }));
}

describe("highlightLocator", () => {
  describe("EPUB anchors", () => {
    it("names the chapter by its title, not its TOC ordinal", () => {
      const chapters = toc(
        ["Cover", 0],
        ["Part One", 4],
        ["Chapter 1: Joost", 6],
        ["Chapter 2: Inej", 8],
      );

      expect(highlightLocator("epubcfi(/6/16!/4/2)", chapters)).toBe(
        "Chapter 1: Joost",
      );
    });

    it("names the chapter a range anchor starts in", () => {
      const chapters = toc(
        ["Front matter", 0],
        ["Chapter 12: Inej", 6],
        ["Kaz", 12],
      );

      expect(
        highlightLocator("epubcfi(/6/14[chap03]!/4/2,/1:0,/1:120)", chapters),
      ).toBe("Chapter 12: Inej");
    });

    it("names the first chapter of a spine item it shares", () => {
      const chapters = toc(
        ["ETYMOLOGY.", 2],
        ["CHAPTER 1. Loomings.", 2],
        ["CHAPTER 8. The Pulpit.", 2],
      ).map((chapter, i) => ({
        ...chapter,
        anchorPath: ["/4/26/6", "/4/32", "/4/346"][i] ?? null,
      }));

      expect(highlightLocator("epubcfi(/6/6!/4/34,/1:0,/1:16)", chapters)).toBe(
        "CHAPTER 1. Loomings.",
      );
    });

    it.each([
      [
        "no chapter table",
        "epubcfi(/6/14[chap03]!/4/2,/1:0,/1:120)",
        [],
        "Section 7",
      ],
      [
        "an untitled chapter",
        "epubcfi(/6/14!/4/2)",
        toc(["", 0], ["   ", 6]),
        "Section 7",
      ],
      [
        "a spot before the first chapter",
        "epubcfi(/6/2!/4)",
        toc(["A", 4], ["B", 8]),
        "Section 1",
      ],
      ["a point anchor", "epubcfi(/6/4!/4/2/2/1:15)", [], "Section 2"],
      ["surrounding whitespace", "  epubcfi(/6/8!/4)  ", [], "Section 4"],
    ])(
      "falls back to the section for %s",
      (_condition, anchor, chapters, locator) => {
        expect(highlightLocator(anchor, chapters)).toBe(locator);
      },
    );

    it.each([
      ["empty text", ""],
      ["prose", "chapter 4, paragraph 2"],
      ["an unclosed CFI", "epubcfi(/6/14!/4/2"],
      ["an odd spine step", "epubcfi(/6/7!/4/2)"],
      ["a zero spine step", "epubcfi(/6/0!/4/2)"],
      ["a non-numeric spine step", "epubcfi(/6/x!/4/2)"],
    ])("returns null for %s", (_condition, anchor) => {
      expect(highlightLocator(anchor, [])).toBeNull();
    });
  });

  describe("PDF anchors", () => {
    const outline = toc(["Cover", 0], ["Chapter I", 5], ["Chapter II", 9]);

    it("names the outline entry covering the page", () => {
      expect(highlightLocator("pdf:7", outline)).toBe("Chapter I");
      expect(highlightLocator("pdf:9", outline)).toBe("Chapter II");
    });

    it("names the page when no outline entry reaches it", () => {
      expect(highlightLocator("pdf:6:0,0,1,0,0,1,1,1", [])).toBe("Page 7");
      expect(highlightLocator("pdf:2", toc(["Chapter I", 5]))).toBe("Page 3");
      expect(highlightLocator("pdf:1", toc(["   ", 0]))).toBe("Page 2");
    });
  });
});

describe("readerDeepLink", () => {
  it("encodes every CFI delimiter into the query", () => {
    expect(readerDeepLink("book-uuid", "epubcfi(/6/14[c]!/4,/1:0)")).toBe(
      "/read/book-uuid?cfi=epubcfi%28%2F6%2F14%5Bc%5D%21%2F4%2C%2F1%3A0%29",
    );
  });

  it("opens a PDF passage by its 1-based page", () => {
    expect(
      readerDeepLink(
        "book-uuid",
        "pdf:3:72.0,710.2,172.0,710.2,72.0,700.0,172.0,700.0",
      ),
    ).toBe("/pdf/book-uuid?page=4");
    expect(readerDeepLink("book-uuid", "pdf:0")).toBe("/pdf/book-uuid?page=1");
  });
});

describe("pdfAnchorPage", () => {
  it.each([
    ["a position anchor", "pdf-page:9", 9],
    ["a page-only highlight", "pdf:9", 9],
    ["a highlight with quads", "pdf:9:0,0,1,0,0,1,1,1", 9],
  ])("reads %s", (_condition, anchor, page) => {
    expect(pdfAnchorPage(anchor)).toBe(page);
  });

  it.each([
    ["a comic anchor", "comic-page:9"],
    ["a CFI", "epubcfi(/6/4)"],
    ["a page that is not a number", "pdf:x"],
    ["quads that are not eight numbers", "pdf:1:1,2,3"],
    ["quads that are not finite", "pdf:1:1,2,3,4,5,6,7,NaN"],
  ])("rejects %s", (_condition, anchor) => {
    expect(pdfAnchorPage(anchor)).toBeNull();
  });
});
