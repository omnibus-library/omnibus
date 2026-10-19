import { describe, expect, it } from "vitest";
import { formatOptions, withFormat } from "./hiddenFormats";

describe("withFormat", () => {
  it("adds a hidden format in sorted order", () => {
    expect(withFormat(["pdf"], "epub", true)).toEqual(["epub", "pdf"]);
  });

  it("removes a format that is shown again", () => {
    expect(withFormat(["epub", "pdf"], "epub", false)).toEqual(["pdf"]);
  });

  it("keeps one entry when a format is hidden twice", () => {
    expect(withFormat(["epub"], "epub", true)).toEqual(["epub"]);
  });
});

describe("formatOptions", () => {
  it("lists the known formats when nothing unknown is hidden", () => {
    expect(formatOptions(["epub"])).toEqual([
      "epub",
      "pdf",
      "cbz",
      "m4b",
      "m4a",
      "mp3",
    ]);
  });

  it("appends a saved format the list does not know", () => {
    expect(formatOptions(["djvu"]).at(-1)).toBe("djvu");
  });
});
