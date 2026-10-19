import { describe, expect, it } from "vitest";
import { matchingSettings } from "./settingsIndex";

const labels = (query: string, isAdmin: boolean) =>
  matchingSettings(query, isAdmin).map((entry) => entry.label);

describe("matchingSettings", () => {
  it("finds a setting by keyword", () => {
    expect(labels("dark", false)).toEqual(["Theme"]);
  });

  it("ignores case", () => {
    expect(labels("KINDLE", false)).toEqual(["Send to Kindle"]);
  });

  it("offers server settings to admins", () => {
    expect(labels("smtp", true)).toEqual(["Email delivery (SMTP)"]);
  });

  it("hides server settings from members", () => {
    expect(labels("smtp", false)).toEqual([]);
  });

  it("returns nothing for a blank query", () => {
    expect(labels("   ", true)).toEqual([]);
  });

  it("returns at most five entries", () => {
    expect(labels("e", true)).toHaveLength(5);
  });
});
