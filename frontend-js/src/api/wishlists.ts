import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { toBook } from "./books";
import type { UserId } from "./core";
import { ok } from "./core";
import { listWishlistReaders, listWishlists } from "./generated/omnibus";
import type { WishlistBook as WishlistBookWire } from "./generated/schemas";

export type { WishlistReader, WishlistReaders } from "./generated/schemas";

// The household wishlists page's reads. Every query key starts with "wishlists", so one
// prefix invalidation refreshes the list, the panel and its counts.

/** A book on a wishlist as the page draws it. */
export function toWishlistBook(wire: WishlistBookWire) {
  return {
    ...toBook(wire.book),
    isbn13: wire.book.isbn13 ?? null,
    addedAt: wire.added_at,
    wantedBy: wire.wanted_by.map((w) => ({ id: w.id as UserId, name: w.name })),
    holdings: wire.holdings,
  };
}

export type WishlistBook = ReturnType<typeof toWishlistBook>;

/** Whose list: the signed-in reader's, everyone's merged, or one reader's. */
export type WishlistUser = "you" | "all" | UserId;

/** Every reader and how many books each wants. */
export const wishlistReadersQuery = queryOptions({
  queryKey: ["wishlists", "readers"],
  queryFn: async () => ok(await listWishlistReaders()),
});

/** One list, newest first. Switching lists keeps the last one on screen until the next answers. */
export const wishlistBooksQuery = (user: WishlistUser) =>
  queryOptions({
    queryKey: ["wishlists", "books", user],
    queryFn: async () =>
      ok(await listWishlists(user === "you" ? {} : { user: String(user) })).map(
        toWishlistBook,
      ),
    placeholderData: keepPreviousData,
  });
