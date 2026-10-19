import { describe, expect, it } from "vitest";
import type { Position } from "../../api";
import { isEpubCfi, readerStart } from "./start";

const STORED = "epubcfi(/6/14!/4/2/1:0)";
const DERIVED = "epubcfi(/6/36!/4/2/1:212)";
const LOCAL = "epubcfi(/6/8!/4/2/1:0)";
const LINK = "epubcfi(/6/20!/4/10/1:4)";

const row = (
  cfi: string | null,
  percent: number | null,
  derivedCfi: string | null = null,
): Position => ({ cfi, percent, derivedCfi, audioSeconds: null, updatedAt: 1 });

const at = (cfi: string) => ({ cfi, holdFirstWrite: false });

describe("readerStart", () => {
  it("opens a deep link over every saved position", () => {
    expect(readerStart(LINK, row(STORED, 30), LOCAL)).toEqual(at(LINK));
  });

  it("restores the server's own cfi over the local save", () => {
    expect(readerStart(null, row(STORED, 30), LOCAL)).toEqual(at(STORED));
  });

  it("opens a percent-only row at its derived cfi rather than the local save", () => {
    expect(readerStart(null, row(null, 42, DERIVED), LOCAL)).toEqual(
      at(DERIVED),
    );
  });

  it("holds the first write when a percent-only row cannot be placed", () => {
    expect(readerStart(null, row(null, 42), null)).toEqual({
      cfi: null,
      holdFirstWrite: true,
    });
  });

  it("restores the local save without a hold when a percent-only row cannot be placed", () => {
    expect(readerStart(null, row(null, 42), LOCAL)).toEqual(at(LOCAL));
  });

  it("never hands epub.js a pdf page anchor", () => {
    const pdf = row("pdf-page:12", 40);

    expect(readerStart(null, pdf, LOCAL)).toEqual(at(LOCAL));
    expect(readerStart(null, pdf, null).holdFirstWrite).toBe(true);
  });

  it.each([
    [1, true],
    [100, true],
    [0, false],
    [101, false],
  ])("sets the first-write hold for a stored %i%% as %s", (percent, held) => {
    expect(readerStart(null, row(null, percent), null).holdFirstWrite).toBe(
      held,
    );
  });

  it.each([
    ["a book never opened", null],
    ["a book stored at 0%", row(null, 0)],
  ])("writes the first landing of %s", (_name, record) => {
    expect(readerStart(null, record, null)).toEqual({
      cfi: null,
      holdFirstWrite: false,
    });
  });
});

describe("isEpubCfi", () => {
  it.each([
    ["a cfi", "epubcfi(/6/4!/4/2,/1:0,/1:42)", true],
    ["a cfi with leading space", "  epubcfi(/6/4)", true],
    ["a pdf page", "pdf-page:3", false],
    ["a comic page", "comic-page:3", false],
    ["a percent", "12.5", false],
  ])("reads %s", (_name, anchor, expected) => {
    expect(isEpubCfi(anchor)).toBe(expected);
  });
});
