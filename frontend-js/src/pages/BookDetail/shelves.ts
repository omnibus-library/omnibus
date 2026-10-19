import type { BookUuid, Shelf, User } from "../../api";
import { LEDGE_BOOKS } from "../../components/ShelfTile/ShelfTile";

/** What the membership block knows once its reads answered. */
export type ShelfFacts = {
  all: Shelf[];
  /** Hand-picked shelves holding the book. */
  manualIds: number[];
  /** Smart shelves whose rules match it. */
  smartIds: number[];
  /** Whether the book is on the reader's Wishlist, read with the shelves so the two agree. */
  wished: boolean;
};

/** The hand-picked shelves the viewer may change: theirs, or anyone's for an admin; never smart or Wishlist. */
export const pickerTargets = (all: readonly Shelf[], viewer: User) =>
  all.filter(
    (s) => s.kind === "manual" && (s.owner.id === viewer.id || viewer.isAdmin),
  );

const named = (all: readonly Shelf[], ids: readonly number[]) =>
  all.filter((s) => ids.includes(s.id));

/** Every shelf holding the book, in the order the block draws them: hand-picked, matching smart, then the viewer's own Wishlist when wished. */
export function heldShelves(facts: ShelfFacts, viewer: User): Shelf[] {
  const wishlist = facts.wished
    ? facts.all.filter((s) => s.kind === "wishlist" && s.owner.id === viewer.id)
    : [];
  return [
    ...named(facts.all, facts.manualIds),
    ...named(facts.all, facts.smartIds),
    ...wishlist,
  ];
}

/** The smart shelves holding the book, for the picker's read-only section. */
export const automaticShelves = (facts: ShelfFacts) =>
  named(facts.all, facts.smartIds);

/** `ids` with `shelfId` added or removed, never duplicated. */
export const withMembership = (
  ids: readonly number[],
  shelfId: number,
  on: boolean,
) =>
  on ? [...new Set([...ids, shelfId])] : ids.filter((id) => id !== shelfId);

/**
 * `shelves` with `shelfId`'s count and ledge following the book going onto it or coming off.
 * A hand-picked shelf files new books last, so a cover joins at the back, and only while the
 * ledge has room.
 */
export function withMemberSummary(
  shelves: readonly Shelf[],
  shelfId: number,
  uuid: BookUuid,
  hasCover: boolean,
  on: boolean,
): Shelf[] {
  return shelves.map((shelf) => {
    if (shelf.id !== shelfId) return shelf;
    const covers = shelf.covers.filter((c) => c !== uuid);
    return {
      ...shelf,
      bookCount: on ? shelf.bookCount + 1 : Math.max(0, shelf.bookCount - 1),
      covers:
        on && hasCover && covers.length < LEDGE_BOOKS
          ? [...covers, uuid]
          : covers,
    };
  });
}
