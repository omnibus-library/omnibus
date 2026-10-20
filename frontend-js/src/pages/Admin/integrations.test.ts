import { describe, expect, it } from "vitest";
import type { EbookConvertStatus } from "../../api";
import {
  clearWarning,
  ebookConvertDetail,
  ebookConvertPlaceholder,
  isOverridden,
  saveOutcomeMessage,
} from "./integrations";

const status = (source: string, path: string): EbookConvertStatus => ({
  available: true,
  path,
  source,
});

describe("clearWarning", () => {
  it("names what clearing the Hardcover key stops and that it cannot be read back", () => {
    expect(clearWarning("hardcover")).toBe(
      "“Readers also enjoyed” suggestions stop until a new key is saved. The key can’t be shown again, so you’ll need the original to put it back.",
    );
  });

  it("names what clearing the Google Books key stops and that it cannot be read back", () => {
    expect(clearWarning("google-books")).toBe(
      "ISBN check-ins fall back to the shared anonymous quota, which runs out quickly. The key can’t be shown again, so you’ll need the original to put it back.",
    );
  });
});

describe("ebookConvertPlaceholder", () => {
  it("falls back to the bare command name before the status lands", () => {
    expect(ebookConvertPlaceholder(undefined)).toBe("ebook-convert");
  });

  it("shows the resolved command once the status lands", () => {
    expect(
      ebookConvertPlaceholder(status("settings", "/opt/calibre/ebook-convert")),
    ).toBe("/opt/calibre/ebook-convert");
  });
});

describe("isOverridden", () => {
  it.each([
    ["a saved settings path", status("settings", "/x"), true],
    ["the environment variable", status("env", "/x"), false],
    ["the PATH lookup", status("path", "ebook-convert"), false],
    ["a status not yet loaded", undefined, false],
  ])("returns whether %s is in force", (_condition, given, expected) => {
    expect(isOverridden(given)).toBe(expected);
  });
});

describe("ebookConvertDetail", () => {
  it("is empty until the status lands", () => {
    expect(ebookConvertDetail(undefined)).toBe("");
  });

  it("names the source and the resolved path", () => {
    expect(
      ebookConvertDetail(status("env", "/usr/local/bin/ebook-convert")),
    ).toBe("Detected · env · /usr/local/bin/ebook-convert");
  });
});

describe("saveOutcomeMessage", () => {
  it("reports a runnable path as saved", () => {
    expect(saveOutcomeMessage(true)).toEqual({
      message: "ebook-convert path saved.",
      error: false,
    });
  });

  it("flags a saved path the server cannot run as an error", () => {
    expect(saveOutcomeMessage(false)).toEqual({
      message: "Path saved, but ebook-convert is not runnable there.",
      error: true,
    });
  });
});
