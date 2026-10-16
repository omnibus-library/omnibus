/** A shelf as `GET /api/shelves` lists it (`ShelfSummary`). */
export type Shelf = {
  id: number;
  owner_user_id: number;
  kind: string;
  name: string;
  book_count: number;
};

/** The id and name a shelf is picked by on screen. */
export type ShelfRef = Pick<Shelf, "id" | "name">;

/** `ownerId`'s own wishlist among `shelves`, which lists others' too. */
export function wishlistOf(shelves: Shelf[], ownerId: number): ShelfRef {
  const wishlist = shelves.find(
    (shelf) => shelf.kind === "wishlist" && shelf.owner_user_id === ownerId,
  );
  if (!wishlist) throw new Error(`user ${ownerId} has no Wishlist shelf`);
  return { id: wishlist.id, name: wishlist.name };
}
