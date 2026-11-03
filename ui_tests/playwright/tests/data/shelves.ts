import { uniqueSuffix } from "./unique";

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

/** One rule of a smart shelf, as the create request sends it. */
export type ShelfRule = { field: string; op: string; value: string };

/** The smart-shelf rule "author is `author`". */
export function authorRule(author: string): ShelfRule {
  return { field: "author", op: "is", value: author };
}

/** The body `POST /api/shelves` takes. */
export type NewShelf = {
  name: string;
  kind: "manual" | "smart";
  description: string | null;
  visibility: "private" | "public";
  match_mode: "all" | "any" | null;
  rules: ShelfRule[];
  book_uuids: string[];
};

/** A smart shelf that matches books by `author`; nothing is hand-picked. */
export function smartShelfBy(author: string): Partial<NewShelf> {
  return { kind: "smart", match_mode: "any", rules: [authorRule(author)] };
}

/** An empty private hand-picked shelf named `label` plus a unique suffix. */
export function buildShelf(
  label: string,
  overrides: Partial<NewShelf> = {},
): NewShelf {
  return {
    name: `${label} ${uniqueSuffix()}`,
    kind: "manual",
    description: null,
    visibility: "private",
    match_mode: null,
    rules: [],
    book_uuids: [],
    ...overrides,
  };
}

/** The body of `PATCH /api/shelves/{id}`; an absent field stays as it is. */
export type ShelfUpdate = Partial<{
  name: string;
  description: string;
  visibility: "private" | "public";
  match_mode: "all" | "any";
  rules: ShelfRule[];
  sync_to_kobo: boolean;
}>;
