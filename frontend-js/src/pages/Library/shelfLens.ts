import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  fetchShelfPage,
  type Shelf,
  type ShelfKind,
  shelfQuery,
  shelvesQuery,
  type UserId,
} from "../../api";
import { bookCount } from "../../format";
import { useCurrentUser } from "../../session";
import {
  loadShelfSelection,
  type Prefs,
  type ShelfSelection,
  saveShelfSelection,
} from "../../viewPrefs";
import { sortLockReason } from "./sorting";

/**
 * The shelves the row carries: the reader's own, plus other readers' public
 * shelves, minus any wishlist nobody has put a book in. The server's order is
 * kept and nothing is capped, as the row pages sideways.
 */
export function railShelves(all: Shelf[], viewerId: UserId): Shelf[] {
  return all.filter((s) => {
    const own = s.owner.id === viewerId;
    // A wishlist is provisioned per account rather than chosen, so another reader's is noise.
    const sharedByAnother = s.visibility === "public" && s.kind !== "wishlist";
    const unusedWishlist = s.kind === "wishlist" && s.bookCount === 0;
    return (own || sharedByAnother) && !unusedWishlist;
  });
}

/** Whether a saved shelf pick names a shelf the row no longer shows: gone, emptied (the reader's wishlist) or no longer shared. */
export function selectionOffRail(
  selection: ShelfSelection,
  all: Shelf[],
  viewerId: UserId,
): boolean {
  return (
    selection.kind === "shelf" &&
    !railShelves(all, viewerId).some((s) => s.id === selection.id)
  );
}

/** What follows a shelf's name in its tab: the count, then the owner when the reader doesn't own it. */
export function shelfTabMeta(count: number, owner: string | null): string {
  return owner === null ? String(count) : `${count} · ${owner}`;
}

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
    bookCount(count),
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
    (s) => s.kind === "manual" && (viewer.isAdmin || s.owner.id === viewer.id),
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

/** Which list the page shows: the saved shelf pick, that shelf's page and detail, and why its sort is locked. */
export function useShelfLens(prefs: Prefs) {
  const [selection, setSelection] = useState(loadShelfSelection);
  const shelfId = selection.kind === "shelf" ? selection.id : null;
  const shelves = useQuery(shelvesQuery).data;
  const lens = { sort: prefs.sort, dir: prefs.dir, clauses: prefs.clauses };
  const shelfPage = useQuery({
    queryKey: ["shelf-page", shelfId, lens],
    queryFn: shelfId === null ? skipToken : () => fetchShelfPage(shelfId, lens),
  });
  // Every member, filter aside: what Add books marks as already on the shelf. Unfiltered it is the lens query itself.
  const whole = { ...lens, clauses: [] };
  const detail = useQuery(shelfQuery(shelfId));
  const members = useQuery({
    queryKey: ["shelf-page", shelfId, whole],
    queryFn:
      shelfId === null ? skipToken : () => fetchShelfPage(shelfId, whole),
    // Only Add books on a manual shelf reads it.
    enabled: detail.data?.kind === "manual",
  });
  const pick = (next: ShelfSelection) => {
    setSelection(next);
    saveShelfSelection(next);
  };

  // A stored shelf the row no longer shows snaps back to All, judged only against a list that loaded.
  const viewerId = useCurrentUser().id;
  useEffect(() => {
    if (!shelves || !selectionOffRail(selection, shelves, viewerId)) return;
    setSelection({ kind: "all" });
    saveShelfSelection({ kind: "all" });
  }, [selection, shelves, viewerId]);

  const sortLock = sortLockReason(
    shelves?.find((s) => s.id === shelfId)?.kind ?? null,
  );
  return { selection, pick, shelfId, shelfPage, members, detail, sortLock };
}
