import {
  parseUserId,
  type UserId,
  type WishlistBook,
  type WishlistReader,
  type WishlistUser,
} from "../../api";
import { bookCount, MONTHS, plural } from "../../format";

/** Whose wishlist the page shows. */
export type Scope =
  | { kind: "you" }
  | { kind: "everyone" }
  | { kind: "reader"; id: UserId };

/** The scope `?user=` names; anything but `all` or another reader's id is your own list. */
export function scopeFrom(param: string | null, viewer: UserId): Scope {
  if (param === "all") return { kind: "everyone" };
  const id = parseUserId(param);
  return id === null || id === viewer
    ? { kind: "you" }
    : { kind: "reader", id };
}

/** The page title for `scope`. */
export function heading(scope: Scope, readers: readonly WishlistReader[]) {
  switch (scope.kind) {
    case "you":
      return "Your Wishlist";
    case "everyone":
      return "Everyone’s Wishlists";
    case "reader": {
      const name = readers.find((r) => r.id === scope.id)?.name;
      return name ? `${name}’s Wishlist` : "Wishlist";
    }
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

/** How many books, and for everyone how many wishlists they sit on, once the readers have answered. */
export function subline(scope: Scope, books: number, wishlists: number | null) {
  return scope.kind === "everyone" && wishlists !== null
    ? `${bookCount(books)} across ${wishlists} wishlist${plural(wishlists)}`
    : bookCount(books);
}

/** A holdings badge: the kind, and `×N` when the library holds more than one. */
export function holdingLabel({
  format,
  count,
}: {
  format: string;
  count: number;
}) {
  return { name: format, times: count > 1 ? `×${count}` : null };
}

/** Who wants a book: the other readers by name, then "you" last, or "You" alone. */
export function wantedByNames(
  wantedBy: readonly { id: UserId; name: string }[],
  viewer: UserId,
) {
  const others = wantedBy.filter((w) => w.id !== viewer).map((w) => w.name);
  if (others.length === wantedBy.length) return others.join(", ");
  return others.length === 0 ? "You" : `${others.join(", ")}, you`;
}

/** The author line: authors, then the series and its number when the book has them. */
export function byline({
  authors,
  series,
}: Pick<WishlistBook, "authors" | "series">) {
  return [
    authors.join(", "),
    ...(series ? [series.name, ...(series.index ? [series.index] : [])] : []),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The day an entry was added, `Oct 30`, with the year once it is not this one; on the UTC calendar every client names the same day. */
export function addedLabel(addedAt: number, now: number) {
  const added = new Date(addedAt * 1000);
  const day = `${MONTHS[added.getUTCMonth()]} ${added.getUTCDate()}`;
  const year = added.getUTCFullYear();
  return year === new Date(now * 1000).getUTCFullYear()
    ? day
    : `${day}, ${year}`;
}

/** The list to ask the API for. */
export function wishlistUser(scope: Scope): WishlistUser {
  switch (scope.kind) {
    case "you":
      return "you";
    case "everyone":
      return "all";
    case "reader":
      return scope.id;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

/** What a reader may ask the library to find for them. */
export type RequestKind = "ebook" | "audiobook";

const AUDIO_FORMATS = ["M4B", "M4A", "MP3"];

/** The kinds the library lacks: print never counts as either, audio is M4B, M4A or MP3, and any other digital format is an ebook. */
export function requestable(
  holdings: readonly { format: string }[],
): RequestKind[] {
  const formats = holdings.map((h) => h.format.toUpperCase());
  const kinds: RequestKind[] = [];
  if (!formats.some((f) => f !== "PRINT" && !AUDIO_FORMATS.includes(f))) {
    kinds.push("ebook");
  }
  if (!formats.some((f) => AUDIO_FORMATS.includes(f))) kinds.push("audiobook");
  return kinds;
}
