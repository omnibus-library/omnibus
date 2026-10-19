import { describe, expect, it } from "vitest";
import { defaultDirFor, SORT_KEYS, sortLabel, toggleDir } from "./sorting";

describe("defaultDirFor", () => {
  it.each([
    ["newest_added", "desc"],
    ["last_updated", "desc"],
    ["recently_interacted", "desc"],
    ["title", "asc"],
    ["author", "asc"],
    ["series", "asc"],
  ] as const)("starts %s %s", (key, dir) => {
    expect(defaultDirFor(key)).toBe(dir);
  });
});

describe("toggleDir", () => {
  it("flips each direction", () => {
    expect(toggleDir("asc")).toBe("desc");
    expect(toggleDir("desc")).toBe("asc");
  });
});

describe("SORT_KEYS", () => {
  it("lists the six axes in the dropdown's order with their labels", () => {
    expect(SORT_KEYS.map(sortLabel)).toEqual([
      "Title",
      "Author",
      "Series",
      "Recently Interacted",
      "Last Updated",
      "Newest Added",
    ]);
  });
});
