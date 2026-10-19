import { describe, expect, it } from "vitest";
import { pagePercent } from "../ComicReader/pager";
import {
  deepLinkPage,
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

  it("passes a page through when the count is unknown, leaving the clamp to the glue", () => {
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
