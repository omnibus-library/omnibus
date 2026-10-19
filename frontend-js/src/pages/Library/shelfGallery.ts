import type { Shelf, ShelfKind, UserId } from "../../api";

/**
 * The shelves the row carries: the reader's own, plus other readers' public
 * shelves, minus any wishlist nobody has put a book in. The server's order is
 * kept and nothing is capped, as the row pages sideways.
 */
export function railShelves(all: Shelf[], viewerId: UserId): Shelf[] {
  return all.filter((s) => {
    const own = s.ownerId === viewerId;
    // A wishlist is provisioned per account rather than chosen, so another reader's is noise.
    const sharedByAnother = s.visibility === "public" && s.kind !== "wishlist";
    const unusedWishlist = s.kind === "wishlist" && s.bookCount === 0;
    return (own || sharedByAnother) && !unusedWishlist;
  });
}

/** The owner a shelf should be attributed to, or `null` for the reader's own and for a wishlist, whose name opens with its owner. */
export function attributedOwner(shelf: Shelf, viewerId: UserId): string | null {
  return shelf.ownerId !== viewerId && shelf.kind !== "wishlist"
    ? shelf.ownerName
    : null;
}

/** What follows a shelf's name in its tab: the count, then the owner when the reader doesn't own it. */
export function shelfTabMeta(count: number, owner: string | null): string {
  return owner === null ? String(count) : `${count} · ${owner}`;
}

const booksOf = (count: number) => `${count} book${count === 1 ? "" : "s"}`;

/** The spoken label of a shelf's tab, which carries the kind its badge glyph only draws. */
export function shelfAriaLabel(
  shelf: Pick<Shelf, "name" | "kind" | "visibility">,
  count: number,
  owner: string | null,
): string {
  const kindWord: Record<ShelfKind, string> = {
    smart: "Smart shelf ",
    wishlist: "Wishlist ",
    manual: "",
  };
  const meta = [
    booksOf(count),
    ...(shelf.visibility === "public" ? ["Public"] : []),
    ...(owner === null ? [] : [`by ${owner}`]),
  ];
  return `${kindWord[shelf.kind]}${shelf.name}, ${meta.join(" · ")}`;
}

/** The hand-picked shelves the reader may file books on: their own, or any for an admin. Never smart or wishlist, which fill themselves. */
export function addTargets(
  shelves: Shelf[],
  viewer: { id: UserId; isAdmin: boolean },
): Shelf[] {
  return shelves.filter(
    (s) => s.kind === "manual" && (viewer.isAdmin || s.ownerId === viewer.id),
  );
}

/**
 * Where a press of a paging arrow scrolls the row to: a step of 60% of its
 * width (240px at least), landing on the entry start in reach nearest the step
 * and never past it, so a page back undoes a page forward.
 */
export function pageTarget(
  dir: 1 | -1,
  from: number,
  width: number,
  scrollWidth: number,
  starts: number[],
): number {
  const want = from + dir * Math.max(240, width * 0.6);
  if (want <= 0) return 0;
  if (want >= scrollWidth - width) return scrollWidth - width;
  const inReach = starts.filter((at) =>
    dir > 0 ? at > from && at <= want : at < from && at >= want,
  );
  // An entry wider than the step leaves no start in reach.
  return (dir > 0 ? inReach.at(-1) : inReach[0]) ?? want;
}
