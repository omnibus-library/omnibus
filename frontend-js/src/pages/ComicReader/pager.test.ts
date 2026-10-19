import { describe, expect, it } from "vitest";
import {
  comicPageAnchor,
  comicStartPage,
  pagePercent,
  parseComicPageAnchor,
} from "./pager";

describe("pagePercent", () => {
  it.each([
    ["the first page of a long book", 0, 219, 0],
    ["the last page", 218, 219, 100],
    ["a one-page book", 0, 1, 100],
    ["a book with no pages", 0, 0, 0],
  ])("reads %s", (_condition, page, count, percent) => {
    expect(pagePercent(page, count)).toBe(percent);
  });
});

describe("comicPageAnchor", () => {
  it("round trips through parseComicPageAnchor", () => {
    expect(parseComicPageAnchor(comicPageAnchor(217))).toBe(217);
  });

  it.each([
    ["a CFI", "epubcfi(/6/4!/4/2:0)"],
    ["an empty page", "comic-page:"],
    ["a PDF anchor", "pdf-page:3"],
  ])("rejects %s", (_condition, anchor) => {
    expect(parseComicPageAnchor(anchor)).toBeNull();
  });
});

describe("comicStartPage", () => {
  it("prefers the exact anchor over the percent", () => {
    expect(comicStartPage("comic-page:41", 10, 219)).toBe(41);
  });

  it("clamps an anchor past the end of a shrunken archive", () => {
    expect(comicStartPage("comic-page:999", null, 219)).toBe(218);
  });

  it("inverts the percent within a page when there is no anchor", () => {
    const percent = pagePercent(107, 219);

    expect(
      Math.abs(comicStartPage(null, percent, 219) - 107),
    ).toBeLessThanOrEqual(1);
  });

  it.each([
    ["a foreign anchor and no percent", "epubcfi(/6/4!/4/2:0)", null, 219],
    ["nothing saved", null, null, 219],
    ["a percent but no pages", null, 50, 0],
  ])("opens page 0 for %s", (_condition, anchor, percent, count) => {
    expect(comicStartPage(anchor, percent, count)).toBe(0);
  });
});
