import type { Shelf, UserId } from "../../api";
import type { DiscoveryPrefs } from "../../viewPrefs";

export type ShelvesSort = DiscoveryPrefs["shelves_sort"];

export type KindFilter = "any" | Shelf["kind"];

/** The kind toggle's options, in toolbar order. */
export const KINDS = [
  ["any", "All"],
  ["smart", "Smart"],
  ["manual", "Hand-picked"],
  ["wishlist", "Wishlists"],
] as const satisfies readonly [KindFilter, string][];

/** Everything that narrows or orders the index; `owner` is `null` for everyone. */
export type ShelfQuery = {
  text: string;
  owner: UserId | null;
  kind: KindFilter;
  sort: ShelvesSort;
};

/** Someone with at least one visible shelf. */
export type ShelfOwner = Shelf["owner"] & {
  isViewer: boolean;
  /** How many visible shelves they own, before any filter. */
  shelfCount: number;
};

export type OwnerGroup = { owner: ShelfOwner; shelves: Shelf[] };

// Code-unit order, as the Dioxus index sorts.
const cmp = <T extends string | number | boolean>(a: T, b: T) =>
  a < b ? -1 : a > b ? 1 : 0;

/** Every owner in `all`: the viewer first, then everyone else by name. */
export function owners(all: readonly Shelf[], viewerId: UserId): ShelfOwner[] {
  const byId = new Map<UserId, ShelfOwner>();
  for (const { owner } of all) {
    const seen = byId.get(owner.id);
    if (seen) seen.shelfCount += 1;
    else {
      byId.set(owner.id, {
        ...owner,
        isViewer: owner.id === viewerId,
        shelfCount: 1,
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      cmp(!a.isViewer, !b.isViewer) ||
      cmp(a.name.toLowerCase(), b.name.toLowerCase()) ||
      cmp(a.id, b.id),
  );
}

/** Whether every whitespace-separated term of `text` is in the shelf's or its owner's name. */
export function matchesText(shelf: Shelf, text: string): boolean {
  const haystack = `${shelf.name} ${shelf.owner.name}`.toLowerCase();
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term.toLowerCase()));
}

/** Whether anything but the sort order hides shelves. */
export const isFiltering = (query: ShelfQuery) =>
  query.text.trim() !== "" || query.owner !== null || query.kind !== "any";

// The Wishlist trails under either axis: it is the one shelf nobody curated.
function inGroupOrder(sort: ShelvesSort) {
  return (a: Shelf, b: Shelf) =>
    cmp(a.kind === "wishlist", b.kind === "wishlist") ||
    (sort === "book_count" ? b.bookCount - a.bookCount : 0) ||
    cmp(a.name.toLowerCase(), b.name.toLowerCase()) ||
    cmp(a.id, b.id);
}

/** `all` filtered by `query`, grouped by owner (viewer first) and ordered by `query.sort`; an owner left with nothing drops out. */
export function groupShelves(
  all: readonly Shelf[],
  viewerId: UserId,
  query: ShelfQuery,
): OwnerGroup[] {
  return owners(all, viewerId)
    .filter((owner) => query.owner === null || query.owner === owner.id)
    .flatMap((owner) => {
      const shelves = all
        .filter(
          (s) =>
            s.owner.id === owner.id &&
            (query.kind === "any" || s.kind === query.kind) &&
            matchesText(s, query.text),
        )
        .sort(inGroupOrder(query.sort));
      return shelves.length > 0 ? [{ owner, shelves }] : [];
    });
}

const count = (n: number, one: string, many: string) =>
  n === 1 ? `1 ${one}` : `${n} ${many}`;

/** The header's census: how many shelves, how many are the viewer's, and how many other readers the rest come from. */
export function census(all: readonly Shelf[], viewerId: UserId): string {
  if (all.length === 0) return "No shelves yet";
  const total = count(all.length, "shelf", "shelves");
  const yours = all.filter((s) => s.owner.id === viewerId).length;
  const others = all.length - yours;
  const readers = owners(all, viewerId).filter((o) => !o.isViewer).length;
  // Every shelf the viewer's: the groups already say so.
  if (others === 0) return total;
  if (yours === 0)
    return `${total} from ${count(readers, "reader", "readers")}`;
  return `${total} · ${yours} yours · ${others} from ${count(readers, "other reader", "other readers")}`;
}

/** Whether the list holds someone else's private shelf, which only an admin's read can. */
export const showsOthersPrivate = (all: readonly Shelf[], viewerId: UserId) =>
  all.some((s) => s.owner.id !== viewerId && s.visibility === "private");

/** A group's heading. */
export const groupTitle = (owner: ShelfOwner) =>
  owner.isViewer ? "Your shelves" : `${owner.name}’s shelves`;

/** What the body says when no card survives: nothing to show at all, a text filter that matched nothing, or toggles that did. */
export function emptyMessage(query: ShelfQuery, hasShelves: boolean): string {
  const text = query.text.trim();
  if (!hasShelves) {
    return "No shelves yet — gather books by hand, or let a rule fill one for you.";
  }
  return text
    ? `No shelves match “${text}”.`
    : "No shelves match these filters.";
}
