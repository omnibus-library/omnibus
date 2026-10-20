import { describe, expect, it } from "vitest";
import {
  formatCacheUsage,
  formatDurationMs,
  ghostedLine,
  pathOrUnconfigured,
} from "./health";

describe("formatDurationMs", () => {
  it.each([
    ["zero", 0, "0 ms"],
    ["one millisecond short of a second", 999, "999 ms"],
    ["exactly a second", 1_000, "1.0 s"],
    ["tenths of a second", 1_500, "1.5 s"],
    ["rounding to a tenth", 14_497, "14.5 s"],
  ])("reads %s", (_condition, ms, text) => {
    expect(formatDurationMs(ms)).toBe(text);
  });
});

describe("formatCacheUsage", () => {
  it("joins the used and cap figures", () => {
    expect(formatCacheUsage({ used: 12_300_000, cap: 5_000_000_000 })).toBe(
      "12.3 MB / 5.0 GB cap",
    );
  });

  it("reads an empty cache as 0 B", () => {
    expect(formatCacheUsage({ used: 0, cap: 0 })).toBe("0 B / 0 B cap");
  });
});

describe("ghostedLine", () => {
  it.each([
    [1, "1 book has no file on disk (ghosted by a prior reindex)."],
    [2, "2 books have no file on disk (ghosted by a prior reindex)."],
  ])("agrees in number for %d", (count, text) => {
    expect(ghostedLine(count)).toBe(text);
  });
});

describe("pathOrUnconfigured", () => {
  it("reports the path when present", () => {
    expect(pathOrUnconfigured("/library")).toBe("/library");
  });

  it.each([
    ["null", null],
    ["absent", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])("reads Not configured when the path is %s", (_condition, path) => {
    expect(pathOrUnconfigured(path)).toBe("Not configured");
  });
});
