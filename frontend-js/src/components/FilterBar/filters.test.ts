import { describe, expect, it } from "vitest";
import type { FilterClause } from "../../api";
import { aShelf, userId } from "../../testing/books";
import {
  facetValue,
  formatOptions,
  MAX_FILTER_VALUES,
  matching,
  namedOptions,
  noMatchLine,
  shelfLabel,
  shelfOptions,
  statusLine,
  togglePick,
  withFieldClause,
  withoutField,
  withStranded,
} from "./filters";

const tag = (...values: string[]): FilterClause => ({
  field: "tag",
  mode: "include",
  values,
});
const viewer = userId(1);

describe("withFieldClause", () => {
  it("replaces every clause on the field and leaves the rest", () => {
    const author: FilterClause = {
      field: "author",
      mode: "include",
      values: ["Ada"],
    };

    expect(withFieldClause([tag("a"), author, tag("b")], tag("c"))).toEqual([
      author,
      tag("c"),
    ]);
  });

  it("clears the field when the clause has no usable value", () => {
    expect(withFieldClause([tag("a")], tag("  ", ""))).toEqual([]);
    expect(withoutField([tag("a")], "tag")).toEqual([]);
  });
});

describe("togglePick", () => {
  it("unticks a value that differs only in case", () => {
    expect(togglePick(["Cozy", "dark"], "cozy")).toEqual(["dark"]);
  });

  it("refuses a new pick past the value cap but still allows an untick", () => {
    const full = Array.from({ length: MAX_FILTER_VALUES }, (_, i) => `v${i}`);

    expect(togglePick(full, "extra")).toBe(full);
    expect(togglePick(full, "v0")).toHaveLength(MAX_FILTER_VALUES - 1);
  });
});

describe("facetValue", () => {
  const loaded = {
    isError: false,
    data: [
      aShelf({
        id: 4,
        name: "Book club",
        ownerId: userId(2),
        ownerName: "bo",
      }),
    ],
  };

  it.each<[FilterClause, string[]]>([
    [tag("a"), ["a"]],
    [{ ...tag("a", "b", "c"), mode: "exclude" }, ["not ", "a", " +2"]],
    [{ field: "format", mode: "include", values: ["epub"] }, ["EPUB"]],
    [{ field: "shelf", mode: "include", values: [" 4 "] }, ["Book club · bo"]],
    [{ field: "shelf", mode: "include", values: ["9"] }, ["unavailable shelf"]],
  ])("reads %j as %j", (clause, parts) => {
    expect(facetValue(clause, loaded, viewer)).toEqual(parts);
  });

  it("leaves a shelf name null while the list is pending and unavailable once it failed", () => {
    const shelf: FilterClause = {
      field: "shelf",
      mode: "include",
      values: ["4"],
    };

    expect(facetValue(shelf, { isError: false }, viewer)).toEqual([null]);
    expect(facetValue(shelf, { isError: true }, viewer)).toEqual([
      "unavailable shelf",
    ]);
  });
});

describe("shelfLabel", () => {
  it("names another reader's shelf with its owner but not a wishlist or your own", () => {
    expect(shelfLabel(aShelf(), viewer)).toBe("Winter reads");
    expect(
      shelfLabel(aShelf({ ownerId: userId(2), ownerName: "bo" }), viewer),
    ).toBe("Winter reads · bo");
    expect(
      shelfLabel(aShelf({ kind: "wishlist", ownerId: userId(2) }), viewer),
    ).toBe("Winter reads");
  });
});

describe("shelfOptions", () => {
  it("offers hand-picked and wishlist shelves by id, never a smart one", () => {
    const options = shelfOptions(
      [
        aShelf(),
        aShelf({ id: 5, kind: "smart" }),
        aShelf({ id: 6, kind: "wishlist" }),
      ],
      viewer,
    );

    expect(options.map((o) => o.value)).toEqual(["3", "6"]);
  });
});

describe("namedOptions", () => {
  it("merges names that differ only in case, adding counts, and drops names the filter would refuse", () => {
    const options = namedOptions([
      { name: "Cozy", count: 2 },
      { name: "cozy ", count: 4 },
      { name: "   ", count: 9 },
      { name: "x".repeat(513), count: 9 },
    ]);

    expect(options).toEqual([{ value: "Cozy", label: "Cozy", count: 6 }]);
  });

  it("keeps names apart that differ beyond ASCII case as the engine compares them", () => {
    const options = namedOptions([
      { name: "Émile", count: 2 },
      { name: "émile", count: 3 },
    ]);

    expect(options).toHaveLength(2);
  });
});

describe("formatOptions", () => {
  it("lists the six formats uppercase", () => {
    expect(formatOptions().map((o) => o.label)).toEqual([
      "EPUB",
      "PDF",
      "CBZ",
      "M4B",
      "M4A",
      "MP3",
    ]);
  });
});

describe("matching", () => {
  it("matches a search by label and caps the rows while counting every match", () => {
    const options = namedOptions(
      Array.from({ length: 5 }, (_, i) => ({ name: `Tag ${i}`, count: 1 })),
    );

    expect(matching(options, " TAG ", 2)).toMatchObject({ total: 5 });
    expect(matching(options, "tag", 2).shown).toHaveLength(2);
    expect(matching(options, "zz", 2)).toEqual({ shown: [], total: 0 });
  });
});

describe("withStranded", () => {
  it("lists a pick the source no longer offers first", () => {
    const list = { options: formatOptions(), cap: null };

    const next = withStranded(list, ["epub", "mobi"], "format");

    expect(next.options[0]).toEqual({
      value: "mobi",
      label: "MOBI",
      count: null,
    });
    expect(withStranded(list, ["epub"], "format")).toBe(list);
    expect(withStranded(list, ["9"], "shelf").options[0]?.label).toBe(
      "unavailable shelf",
    );
  });
});

describe("statusLine", () => {
  it("says when a row cap cut the matches and when a full cloud holds only its most-used", () => {
    expect(statusLine("tags", 200, 450, null)).toBe(
      "Showing 200 of 450 · search to narrow",
    );
    expect(statusLine("tags", 3, 3, null)).toBeNull();
    expect(statusLine("tags", 200, 500, 500)).toBe(
      "Showing 200 of the 500 most-used tags · search narrows within them",
    );
  });
});

describe("noMatchLine", () => {
  it("words an unmatched search, noting a capped source", () => {
    expect(noMatchLine("tags", " zz ", null)).toBe("No tags match “zz”.");
    expect(noMatchLine("tags", "zz", 500)).toBe(
      "No tags match “zz” among the 500 most-used.",
    );
  });
});
