import { describe, expect, it } from "vitest";
import type { UserId } from "../../api";
import { aShelf } from "../../testing/books";
import {
  attributedOwner,
  railShelves,
  shelfAriaLabel,
  shelfTabMeta,
} from "./shelfGallery";

const ME = 1 as UserId;
const THEM = 2 as UserId;

describe("railShelves", () => {
  it("keeps the readers own shelves whatever their visibility or kind", () => {
    const all = [
      aShelf({ id: 1, visibility: "private", bookCount: 0 }),
      aShelf({ id: 2, kind: "smart", visibility: "public" }),
    ];

    expect(railShelves(all, ME).map((s) => s.id)).toEqual([1, 2]);
  });

  it("keeps another readers public shelf but not their private one", () => {
    const all = [
      aShelf({ id: 1, ownerId: THEM, visibility: "public" }),
      aShelf({ id: 2, ownerId: THEM, visibility: "private" }),
    ];

    expect(railShelves(all, ME).map((s) => s.id)).toEqual([1]);
  });

  it("drops another readers wishlist even when stocked", () => {
    const all = [
      aShelf({ ownerId: THEM, kind: "wishlist", visibility: "public" }),
    ];

    expect(railShelves(all, ME)).toEqual([]);
  });

  it("drops an empty wishlist and keeps a stocked one", () => {
    expect(
      railShelves([aShelf({ kind: "wishlist", bookCount: 0 })], ME),
    ).toEqual([]);
    expect(
      railShelves([aShelf({ id: 9, kind: "wishlist", bookCount: 1 })], ME).map(
        (s) => s.id,
      ),
    ).toEqual([9]);
  });

  it("keeps the servers order and every qualifying shelf", () => {
    const all = Array.from({ length: 12 }, (_, i) => aShelf({ id: i + 1 }));

    expect(railShelves(all, ME).map((s) => s.id)).toEqual(all.map((s) => s.id));
  });
});

describe("attributedOwner", () => {
  it("names the owner of a shelf the reader does not own", () => {
    expect(
      attributedOwner(aShelf({ ownerId: THEM, ownerName: "bo" }), ME),
    ).toBe("bo");
  });

  it("names nobody on the readers own shelf or on a wishlist", () => {
    expect(attributedOwner(aShelf(), ME)).toBeNull();
    expect(
      attributedOwner(aShelf({ ownerId: THEM, kind: "wishlist" }), ME),
    ).toBeNull();
  });
});

describe("shelfTabMeta", () => {
  it("is the count alone on the readers own shelf", () => {
    expect(shelfTabMeta(12, null)).toBe("12");
  });

  it("names the owner after the count on someone elses shelf", () => {
    expect(shelfTabMeta(12, "bo")).toBe("12 · bo");
  });
});

describe("shelfAriaLabel", () => {
  it("names the kind the badge glyph only draws", () => {
    const smart = aShelf({
      name: "Space Operas",
      kind: "smart",
      visibility: "public",
    });

    expect(shelfAriaLabel(smart, 12, null)).toBe(
      "Smart shelf Space Operas, 12 books · Public",
    );
    expect(shelfAriaLabel(aShelf({ name: "Reread" }), 1, null)).toBe(
      "Reread, 1 book",
    );
  });

  it("speaks the owner of someone elses shelf", () => {
    expect(shelfAriaLabel(aShelf({ name: "Picks" }), 0, "bo")).toBe(
      "Picks, 0 books · by bo",
    );
  });
});
