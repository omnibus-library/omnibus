import { describe, expect, it } from "vitest";
import {
  defaultDirFor,
  headerSort,
  SORT_KEYS,
  sortLabel,
  sortLockReason,
  toggleDir,
} from "./sorting";

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

describe("headerSort", () => {
  it("flips the direction of the active axis", () => {
    expect(headerSort({ sort: "title", dir: "asc" }, "title")).toEqual({
      sort: "title",
      dir: "desc",
    });
  });

  it("starts another axis in its default direction", () => {
    expect(headerSort({ sort: "title", dir: "asc" }, "newest_added")).toEqual({
      sort: "newest_added",
      dir: "desc",
    });
  });
});

describe("sortLockReason", () => {
  it.each([
    ["a hand-picked shelf", "manual", "shelf order"],
    ["a wishlist", "wishlist", "shelf order"],
    ["a smart shelf", "smart", null],
    ["the whole library", null, null],
  ] as const)("reads %s as %s", (_name, kind, reason) => {
    expect(sortLockReason(kind)).toBe(reason);
  });
});
