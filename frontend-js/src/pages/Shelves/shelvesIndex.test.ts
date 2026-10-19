import { describe, expect, it } from "vitest";
import type { Shelf, UserId } from "../../api";
import {
  census,
  emptyMessage,
  groupShelves,
  groupTitle,
  isFiltering,
  matchesText,
  owners,
  type ShelfQuery,
  showsOthersPrivate,
} from "./shelvesIndex";

const ADA = 1 as UserId;
const BOB = 2 as UserId;
const CY = 3 as UserId;

function aShelf(id: number, overrides: Partial<Shelf> = {}): Shelf {
  return {
    id,
    kind: "manual",
    name: `Shelf ${id}`,
    visibility: "public",
    accent: null,
    bookCount: 0,
    covers: [],
    owner: { id: ADA, name: "ada", hasAvatar: false },
    ...overrides,
  };
}

const ownedBy = (id: UserId, name: string): Shelf["owner"] => ({
  id,
  name,
  hasAvatar: false,
});

const QUERY: ShelfQuery = { text: "", owner: null, kind: "any", sort: "name" };

describe("owners", () => {
  it("lists the viewer first then the rest by name with their counts", () => {
    const all = [
      aShelf(1, { owner: ownedBy(CY, "Cy") }),
      aShelf(2, { owner: ownedBy(BOB, "bob") }),
      aShelf(3),
      aShelf(4, { owner: ownedBy(BOB, "bob") }),
    ];

    expect(
      owners(all, ADA).map((o) => [o.name, o.isViewer, o.shelfCount]),
    ).toEqual([
      ["ada", true, 1],
      ["bob", false, 2],
      ["Cy", false, 1],
    ]);
  });
});

describe("matchesText", () => {
  it.each([
    ["every term in the shelf name", "winter reads"],
    ["terms split between shelf and owner", "WINTER ada"],
    ["a blank query", "   "],
  ])("keeps a shelf for %s", (_condition, text) => {
    expect(matchesText(aShelf(1, { name: "Winter reads" }), text)).toBe(true);
  });

  it("drops a shelf when one term is missing", () => {
    expect(matchesText(aShelf(1, { name: "Winter reads" }), "winter bob")).toBe(
      false,
    );
  });
});

describe("groupShelves", () => {
  const all = [
    aShelf(1, { name: "Zeta", bookCount: 9 }),
    aShelf(2, { name: "alpha", bookCount: 1 }),
    aShelf(3, { name: "Wishlist", kind: "wishlist", bookCount: 50 }),
    aShelf(4, { name: "Bobs", owner: ownedBy(BOB, "bob"), kind: "smart" }),
  ];

  it("groups the viewer first and keeps the wishlist last under A to Z", () => {
    const groups = groupShelves(all, ADA, QUERY);

    expect(groups.map((g) => g.owner.name)).toEqual(["ada", "bob"]);
    expect(groups[0]?.shelves.map((s) => s.name)).toEqual([
      "alpha",
      "Zeta",
      "Wishlist",
    ]);
  });

  it("orders by count then name and keeps the wishlist last under Most books", () => {
    const groups = groupShelves(all, ADA, { ...QUERY, sort: "book_count" });

    expect(groups[0]?.shelves.map((s) => s.name)).toEqual([
      "Zeta",
      "alpha",
      "Wishlist",
    ]);
  });

  it("narrows to one owner and drops the others", () => {
    const groups = groupShelves(all, ADA, { ...QUERY, owner: BOB });

    expect(groups.map((g) => g.owner.name)).toEqual(["bob"]);
  });

  it("drops an owner left with no shelf of the kind", () => {
    const groups = groupShelves(all, ADA, { ...QUERY, kind: "smart" });

    expect(groups.map((g) => g.owner.name)).toEqual(["bob"]);
  });

  it("returns nothing when no shelf matches the text", () => {
    expect(groupShelves(all, ADA, { ...QUERY, text: "zzz" })).toEqual([]);
  });
});

describe("census", () => {
  it.each([
    ["no shelves", [], "No shelves yet"],
    ["only the viewer's shelves", [aShelf(1), aShelf(2)], "2 shelves"],
    ["one shelf", [aShelf(1)], "1 shelf"],
    [
      "only others' shelves",
      [aShelf(1, { owner: ownedBy(BOB, "bob") })],
      "1 shelf from 1 reader",
    ],
    [
      "both",
      [
        aShelf(1),
        aShelf(2, { owner: ownedBy(BOB, "bob") }),
        aShelf(3, { owner: ownedBy(CY, "cy") }),
      ],
      "3 shelves · 1 yours · 2 from 2 other readers",
    ],
  ])("reads %s", (_condition, all, line) => {
    expect(census(all, ADA)).toBe(line);
  });
});

describe("showsOthersPrivate", () => {
  it("is true only for someone else's private shelf", () => {
    const theirs = aShelf(1, {
      owner: ownedBy(BOB, "bob"),
      visibility: "private",
    });

    expect(showsOthersPrivate([theirs], ADA)).toBe(true);
    expect(showsOthersPrivate([{ ...theirs, visibility: "public" }], ADA)).toBe(
      false,
    );
    expect(
      showsOthersPrivate([aShelf(2, { visibility: "private" })], ADA),
    ).toBe(false);
  });
});

describe("groupTitle", () => {
  it("names the viewer's group Your shelves and another's by owner", () => {
    const [mine, theirs] = owners(
      [aShelf(1), aShelf(2, { owner: ownedBy(BOB, "bob") })],
      ADA,
    );

    expect(mine && groupTitle(mine)).toBe("Your shelves");
    expect(theirs && groupTitle(theirs)).toBe("bob’s shelves");
  });
});

describe("emptyMessage", () => {
  it.each([
    [
      "no shelves at all",
      QUERY,
      false,
      "No shelves yet — gather books by hand, or let a rule fill one for you.",
    ],
    ["a text filter", { ...QUERY, text: " x " }, true, "No shelves match “x”."],
    [
      "the toggles",
      { ...QUERY, kind: "smart" as const },
      true,
      "No shelves match these filters.",
    ],
  ])("says so for %s", (_condition, query, hasShelves, message) => {
    expect(emptyMessage(query, hasShelves)).toBe(message);
  });
});

describe("isFiltering", () => {
  it("ignores the sort and counts text, owner and kind", () => {
    expect(isFiltering({ ...QUERY, sort: "book_count" })).toBe(false);
    expect(isFiltering({ ...QUERY, text: "a" })).toBe(true);
    expect(isFiltering({ ...QUERY, owner: BOB })).toBe(true);
    expect(isFiltering({ ...QUERY, kind: "smart" })).toBe(true);
  });
});
