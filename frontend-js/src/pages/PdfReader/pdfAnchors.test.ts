import { describe, expect, it } from "vitest";
import type { Highlight, HighlightColor } from "../../api";
import { pdfAnchorPage } from "../BookDetail/highlightAnchors";
import { pagePercent } from "../ComicReader/pager";
import {
  deepLinkPage,
  encodePdfAnchor,
  paintList,
  parsePdfPageAnchor,
  pdfPageAnchor,
  pdfStartPage,
} from "./pdfAnchors";

describe("pdfPageAnchor", () => {
  it("round trips through parsePdfPageAnchor", () => {
    expect(parsePdfPageAnchor(pdfPageAnchor(12))).toBe(12);
  });

  it.each([
    ["a comic anchor", "comic-page:7"],
    ["a CFI", "epubcfi(/6/4!/4/2)"],
    ["a highlight anchor", "pdf:7"],
    ["an empty page", "pdf-page:"],
  ])("rejects %s", (_condition, anchor) => {
    expect(parsePdfPageAnchor(anchor)).toBeNull();
  });
});

describe("deepLinkPage", () => {
  it.each([
    ["1", 0],
    ["12", 11],
    ["0", null],
    ["-3", null],
    ["seven", null],
    ["7abc", null],
    [null, null],
  ])("reads ?page=%s as %s", (raw, page) => {
    expect(deepLinkPage(raw)).toBe(page);
  });
});

describe("pdfStartPage", () => {
  it("prefers the deep link over a saved position", () => {
    expect(pdfStartPage(6, "pdf-page:41", 90, 100)).toBe(6);
  });

  it("prefers the saved anchor over the percent", () => {
    expect(pdfStartPage(null, "pdf-page:41", 10, 219)).toBe(41);
  });

  it("inverts the percent within a page when there is no anchor", () => {
    const percent = pagePercent(107, 219);

    expect(
      Math.abs(pdfStartPage(null, null, percent, 219) - 107),
    ).toBeLessThanOrEqual(1);
  });

  it("opens page 0 when nothing is saved", () => {
    expect(pdfStartPage(null, null, null, 219)).toBe(0);
  });

  it("clamps once the page count is known", () => {
    expect(pdfStartPage(999, null, null, 12)).toBe(11);
    expect(pdfStartPage(null, "pdf-page:999", null, 12)).toBe(11);
  });

  it("passes a page through when the count is unknown", () => {
    expect(pdfStartPage(999, null, null, 0)).toBe(999);
    expect(pdfStartPage(null, null, 50, 0)).toBe(0);
  });

  it.each([
    ["a comic anchor", "comic-page:7"],
    ["a CFI", "epubcfi(/6/4!/4/2)"],
    ["a highlight anchor", "pdf:7"],
  ])("ignores %s", (_condition, anchor) => {
    expect(pdfStartPage(null, anchor, null, 20)).toBe(0);
  });
});

const QUAD = [72, 710.5, 172, 710.5, 72, 700, 172, 700];

describe("encodePdfAnchor", () => {
  it("writes the page and every quad at one decimal", () => {
    expect(encodePdfAnchor(3, [QUAD, [1, 2, 3, 4, 5, 6, 7, 8]])).toBe(
      "pdf:3:72.0,710.5,172.0,710.5,72.0,700.0,172.0,700.0;1.0,2.0,3.0,4.0,5.0,6.0,7.0,8.0",
    );
  });

  it("names the page alone when there are no quads", () => {
    expect(encodePdfAnchor(5, [])).toBe("pdf:5");
  });

  it("keeps the quads at the cap of 60", () => {
    expect(encodePdfAnchor(2, Array(60).fill(QUAD))).toMatch(/^pdf:2:72\.0,/);
  });

  it("names the page alone one quad past the cap", () => {
    expect(encodePdfAnchor(2, Array(61).fill(QUAD))).toBe("pdf:2");
  });

  it("round trips through pdfAnchorPage", () => {
    expect(pdfAnchorPage(encodePdfAnchor(9, [QUAD]))).toBe(9);
  });
});

const highlight = (
  anchor: string | null,
  color: HighlightColor = "amber",
): Highlight => ({
  id: 1,
  bookUuid: "book",
  color,
  text: null,
  note: null,
  anchor,
  createdAt: 0,
});

describe("paintList", () => {
  it("keeps only the highlights with a placeable pdf anchor", () => {
    const list = paintList([
      highlight("pdf:2:0,0,1,0,0,1,1,1", "green"),
      highlight("epubcfi(/6/4!/4/2,/1:0,/1:4)"),
      highlight(null),
      highlight("pdf:7", "rose"),
      highlight("pdf:2:1,2,3"),
      highlight("pdf-page:7"),
    ]);

    expect(list).toEqual([
      { anchor: "pdf:2:0,0,1,0,0,1,1,1", color: "green" },
      { anchor: "pdf:7", color: "rose" },
    ]);
  });
});
