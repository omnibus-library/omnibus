import { describe, expect, it } from "vitest";
import type { LibrarySection } from "../../api";
import { librarySummaryLine, SourcesSchema } from "./sources";

function section(
  totalFiles: number,
  countsByExt: [string, number][],
): LibrarySection {
  return {
    path: "/library",
    total_files: totalFiles,
    counts_by_ext: countsByExt,
  };
}

const FORM = {
  ebook_library_path: "/books",
  audiobook_library_path: "",
  scan_interval_hours: "",
};

describe("SourcesSchema", () => {
  describe("interval", () => {
    it.each([
      ["a non-numeric entry", "soon"],
      ["a decimal", "1.5"],
      ["a negative number", "-1"],
      ["an exponent", "1e3"],
      ["one past the largest whole number the server reads", "4294967296"],
    ])("refuses %s", (_condition, interval) => {
      const result = SourcesSchema.safeParse({
        ...FORM,
        scan_interval_hours: interval,
      });

      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ["scan_interval_hours"],
          message: "Enter a whole number of hours, or leave it blank.",
        }),
      ]);
    });

    it.each([
      ["a blank interval", "", null],
      ["an interval of spaces", "  ", null],
      ["zero, which the server refuses", "0", 0],
      ["the smallest valid interval", "1", 1],
      ["a padded interval", " 24 ", 24],
      ["the largest whole number the server reads", "4294967295", 4294967295],
    ])("sends %s", (_condition, interval, hours) => {
      expect(
        SourcesSchema.parse({ ...FORM, scan_interval_hours: interval }),
      ).toEqual({
        ebook_library_path: "/books",
        audiobook_library_path: null,
        scan_interval_hours: hours,
      });
    });
  });

  describe("paths", () => {
    it("trims each path", () => {
      expect(
        SourcesSchema.parse({
          ebook_library_path: " /books ",
          audiobook_library_path: " /audio ",
          scan_interval_hours: "24",
        }),
      ).toEqual({
        ebook_library_path: "/books",
        audiobook_library_path: "/audio",
        scan_interval_hours: 24,
      });
    });

    it("sends a blank path as null", () => {
      expect(
        SourcesSchema.parse({ ...FORM, audiobook_library_path: "  " }),
      ).toMatchObject({ audiobook_library_path: null });
    });
  });
});

describe("librarySummaryLine", () => {
  it("counts one file in the singular", () => {
    expect(librarySummaryLine(section(1, []))).toBe("1 file found.");
  });

  it("counts no files in the plural", () => {
    expect(librarySummaryLine(section(0, []))).toBe("0 files found.");
  });

  it("appends a clause per extension in the order given, zeros included", () => {
    expect(
      librarySummaryLine(
        section(5, [
          ["pdf", 1],
          ["epub", 4],
          ["cbz", 0],
        ]),
      ),
    ).toBe("5 files found. 1 .pdf found. 4 .epub found. 0 .cbz found.");
  });
});
