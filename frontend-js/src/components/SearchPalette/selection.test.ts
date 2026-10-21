import { describe, expect, it } from "vitest";
import { toPalette } from "../../api";
import { matchingSettings } from "../../settingsIndex";
import { aWirePalette } from "../../testing/wire";
import {
  itemHref,
  itemKey,
  moveSelection,
  paletteGroups,
  selectedIndex,
} from "./selection";

const results = toPalette(aWirePalette());

const rows = (...args: Parameters<typeof paletteGroups>) =>
  paletteGroups(...args).flatMap((group) => group.items);

describe("paletteGroups", () => {
  it("lists server groups before settings", () => {
    const groups = paletteGroups(results, matchingSettings("theme", false));

    expect(groups.map((group) => group.label)).toEqual([
      "Books",
      "Authors",
      "Series",
      "Tags",
      "Genres",
      "Settings",
    ]);
  });

  it("drops a group with no hits", () => {
    const groups = paletteGroups(toPalette(aWirePalette({ books: [] })), []);

    expect(groups.map((group) => group.label)).not.toContain("Books");
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
    const [theme] = rows(undefined, settings);
    if (!theme) throw new Error("expected a theme setting");

    expect(selectedIndex(rows(results, settings), itemKey(theme))).toBe(5);
  });

  it("returns to the top when the highlighted item is gone", () => {
    expect(selectedIndex(rows(results, []), "book:gone")).toBe(0);
  });
});

describe("itemHref", () => {
  it("links a tag to its facet search", () => {
    const hit = { id: 9, name: "space opera", bookCount: 12 };

    expect(itemHref({ kind: "tag", hit })).toBe(
      "/search/tag%3A%22space%20opera%22",
    );
  });
});
