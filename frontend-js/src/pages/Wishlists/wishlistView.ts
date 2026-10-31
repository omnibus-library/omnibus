import {
  type ExternalBookMeta,
  PROVIDERS,
  parseUserId,
  type ScanBook,
  type ScanOutcome,
  type UserId,
  type WishlistBook,
  type WishlistReader,
  type WishlistUser,
} from "../../api";
import { bookCount, plural } from "../../format";

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

/** The reader whose list `scope` shows, or `null` for everyone's or a reader who isn't listed. */
export function readerOf(scope: Scope, readers: readonly WishlistReader[]) {
  switch (scope.kind) {
    case "you":
      return readers.find((r) => r.is_you) ?? null;
    case "reader":
      return readers.find((r) => r.id === scope.id) ?? null;
    case "everyone":
      return null;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

/** The page title for `scope`. */
export function heading(scope: Scope, readers: readonly WishlistReader[]) {
  switch (scope.kind) {
    case "you":
      return "Your Wishlist";
    case "everyone":
      return "Everyone’s Wishlists";
    case "reader": {
      const name = readerOf(scope, readers)?.name;
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

/** The day an entry was added on the viewer's calendar, `Oct 30`, with the year once it is not this one. */
export function addedLabel(addedAt: number, now: number) {
  const added = new Date(addedAt * 1000);
  const otherYear = added.getFullYear() !== new Date(now * 1000).getFullYear();
  return added.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(otherYear && { year: "numeric" }),
  });
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

/** What an ISBN lookup puts under "In your library" and under the providers' name. */
export function isbnResults(outcome: ScanOutcome): {
  library: ScanBook[];
  online: ExternalBookMeta[];
} {
  switch (outcome.kind) {
    case "already_owned":
    case "on_wishlist":
    case "in_library_unowned":
      return { library: [outcome.book], online: [] };
    case "close_match":
      return {
        library: [outcome.book, ...(outcome.others ?? [])],
        online: [outcome.scanned],
      };
    case "not_in_library":
      return { library: [], online: [outcome.online] };
    case "unresolved":
      return { library: [], online: [] };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/** The library book an outcome matched, so a provider's record goes onto its list and is never minted as a second book. A different edition of the same work is the same book, so a close match counts. */
export function existingBook(outcome: ScanOutcome): ScanBook | null {
  switch (outcome.kind) {
    case "already_owned":
    case "on_wishlist":
    case "in_library_unowned":
    case "close_match":
      return outcome.book;
    case "not_in_library":
    case "unresolved":
      return null;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/** The heading over the providers' results: the provider or providers that answered. */
export function onlineHeading(online: readonly ExternalBookMeta[]) {
  const names = [...new Set(online.map((meta) => PROVIDERS[meta.source].name))];
  return names.length > 0
    ? `From ${names.join(" and ")}`
    : "From online providers";
}
