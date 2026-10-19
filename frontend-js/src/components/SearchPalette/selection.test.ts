import { describe, expect, it } from "vitest";
import { parsePalette } from "../../api";
import { matchingSettings } from "../../settingsIndex";
import { aWirePalette } from "../../testing/wire";
import {
  itemHref,
  itemKey,
  moveSelection,
  paletteItems,
  selectedIndex,
} from "./selection";

const results = parsePalette(aWirePalette());

describe("paletteItems", () => {
  it("lists server groups before settings", () => {
    const items = paletteItems(results, matchingSettings("theme", false));

    expect(items.map((item) => item.kind)).toEqual([
      "book",
      "author",
      "series",
      "tag",
      "genre",
      "setting",
    ]);
  });
});

describe("moveSelection", () => {
  it("lands on the first item on the first arrow down", () => {
    expect(moveSelection(null, 4, "down")).toBe(0);
  });

  it("lands on the last item on the first arrow up", () => {
    expect(moveSelection(null, 4, "up")).toBe(3);
  });

  it.each([
    ["down past the last item", 3, "down", 0],
    ["up past the first item", 0, "up", 3],
  ] as const)("wraps %s", (_case, from, direction, to) => {
    expect(moveSelection(from, 4, direction)).toBe(to);
  });

  it("steps one item at a time", () => {
    expect(moveSelection(1, 4, "down")).toBe(2);
  });

  it("highlights nothing in an empty list", () => {
    expect(moveSelection(null, 0, "down")).toBeNull();
  });
});

describe("selectedIndex", () => {
  it("keeps the highlighted item when results change", () => {
    const settings = matchingSettings("theme", false);
    const [theme] = paletteItems(undefined, settings);
    if (!theme) throw new Error("expected a theme setting");

    expect(selectedIndex(paletteItems(results, settings), itemKey(theme))).toBe(
      5,
    );
  });

  it("returns to the top when the highlighted item is gone", () => {
    expect(selectedIndex(paletteItems(results, []), "book:gone")).toBe(0);
  });
});

describe("itemHref", () => {
  it("links a tag to its facet search", () => {
    expect(itemHref({ kind: "tag", id: 9, name: "space opera" })).toBe(
      "/search/tag%3A%22space%20opera%22",
    );
  });
});
