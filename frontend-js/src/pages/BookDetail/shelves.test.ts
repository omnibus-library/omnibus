import { describe, expect, it } from "vitest";
import { type BookUuid, type Shelf, toUser, type UserId } from "../../api";
import { WIRE_ADA } from "../../testing/wire";
import {
  automaticShelves,
  heldShelves,
  pickerTargets,
  type ShelfFacts,
  withMemberSummary,
  withMembership,
} from "./shelves";

const ADA = toUser(WIRE_ADA);
const READER = { ...ADA, isAdmin: false };
const BOOK = "b0" as BookUuid;
const cover = (n: number) => `c${n}` as BookUuid;

function aShelf(overrides: Partial<Shelf> = {}): Shelf {
  return {
    id: 1,
    kind: "manual",
    name: "Shelf",
    visibility: "private",
    accent: null,
    bookCount: 0,
    covers: [],
    owner: { id: ADA.id, name: "ada", hasAvatar: false },
    ...overrides,
  };
}

const stranger = { id: 9 as UserId, name: "grace", hasAvatar: false };

describe("pickerTargets", () => {
  const shelves = [
    aShelf({ id: 1 }),
    aShelf({ id: 2, owner: stranger }),
    aShelf({ id: 3, kind: "smart" }),
    aShelf({ id: 4, kind: "wishlist" }),
  ];

  it("lists only the viewer's own hand-picked shelves", () => {
    expect(pickerTargets(shelves, READER).map((s) => s.id)).toEqual([1]);
  });

  it("lists every hand-picked shelf for an admin, never smart or wishlist", () => {
    expect(pickerTargets(shelves, ADA).map((s) => s.id)).toEqual([1, 2]);
  });
});

describe("heldShelves", () => {
  const all = [
    aShelf({ id: 1 }),
    aShelf({ id: 2, kind: "smart" }),
    aShelf({ id: 3 }),
    aShelf({ id: 4, kind: "wishlist" }),
    aShelf({ id: 5, kind: "wishlist", owner: stranger }),
  ];
  const facts: ShelfFacts = {
    all,
    manualIds: [3, 1],
    smartIds: [2],
    wished: true,
  };

  it("draws hand-picked, then smart, then the viewer's own wishlist", () => {
    expect(heldShelves(facts, ADA).map((s) => s.id)).toEqual([1, 3, 2, 4]);
  });

  it("never names another reader's hand-picked or smart shelf", () => {
    const theirs = [
      aShelf({ id: 6, owner: stranger }),
      aShelf({ id: 7, kind: "smart", owner: stranger }),
    ];

    const held = heldShelves(
      {
        ...facts,
        all: [...all, ...theirs],
        manualIds: [3, 1, 6],
        smartIds: [2, 7],
      },
      ADA,
    );

    expect(held.map((s) => s.id)).toEqual([1, 3, 2, 4]);
  });

  it("leaves the wishlist out when the book is not wished", () => {
    expect(
      heldShelves({ ...facts, wished: false }, ADA).map((s) => s.id),
    ).toEqual([1, 3, 2]);
  });
});

describe("automaticShelves", () => {
  it("names the smart shelves holding the book", () => {
    const facts: ShelfFacts = {
      all: [aShelf({ id: 1 }), aShelf({ id: 2, kind: "smart" })],
      manualIds: [1],
      smartIds: [2],
      wished: false,
    };
    expect(automaticShelves(facts).map((s) => s.id)).toEqual([2]);
  });
});

describe("withMembership", () => {
  it("adds a shelf once", () => {
    expect(withMembership([1], 2, true)).toEqual([1, 2]);
    expect(withMembership([1, 2], 2, true)).toEqual([1, 2]);
  });

  it("removes a shelf", () => {
    expect(withMembership([1, 2], 1, false)).toEqual([2]);
  });
});

describe("withMemberSummary", () => {
  const shelf = aShelf({ id: 1, bookCount: 2, covers: [cover(1), cover(2)] });

  it("counts the book in and stands its cover at the back", () => {
    const [next] = withMemberSummary([shelf], 1, BOOK, true, true);
    expect(next).toMatchObject({
      bookCount: 3,
      covers: [cover(1), cover(2), BOOK],
    });
  });

  it("counts a book with no cover without standing one", () => {
    const [next] = withMemberSummary([shelf], 1, BOOK, false, true);
    expect(next).toMatchObject({ bookCount: 3, covers: [cover(1), cover(2)] });
  });

  it("leaves a full ledge alone", () => {
    const full = aShelf({
      id: 1,
      bookCount: 9,
      covers: [1, 2, 3, 4].map(cover),
    });
    const [next] = withMemberSummary([full], 1, BOOK, true, true);
    expect(next).toMatchObject({
      bookCount: 10,
      covers: [1, 2, 3, 4].map(cover),
    });
  });

  it("takes the cover and the count off again, never below zero", () => {
    const holding = aShelf({ id: 1, bookCount: 1, covers: [BOOK] });
    const [off] = withMemberSummary([holding], 1, BOOK, true, false);
    expect(off).toMatchObject({ bookCount: 0, covers: [] });
    const [again] = withMemberSummary([off as Shelf], 1, BOOK, true, false);
    expect(again?.bookCount).toBe(0);
  });

  it("does not stand a cover twice", () => {
    const holding = aShelf({ id: 1, bookCount: 1, covers: [BOOK] });
    const [next] = withMemberSummary([holding], 1, BOOK, true, true);
    expect(next?.covers).toEqual([BOOK]);
  });

  it("leaves other shelves as they were", () => {
    const other = aShelf({ id: 2, bookCount: 5 });
    expect(withMemberSummary([shelf, other], 1, BOOK, true, true)[1]).toBe(
      other,
    );
  });
});
