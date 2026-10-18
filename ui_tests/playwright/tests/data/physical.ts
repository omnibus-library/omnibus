/** A physical copy as `GET /api/physical/:uuid/copies` lists it. */
export type PhysicalCopy = {
  id: number;
  book_uuid: string;
  added_by_name?: string;
  note: string | null;
};

/** A copy a test filed, told apart from every other copy by its note. */
export type FiledCopy = { bookUuid: string; note: string };

// batch-D: the physical-collection rows a spec stubs the panel's reads with
/** A copy as `POST /api/rpc/physical/copies` lists it. */
export type CopyRow = PhysicalCopy & {
  isbn: string | null;
  added_by_user_id: number | null;
  checked_in_at: number;
};

/** A wishlist entry as `POST /api/rpc/physical/wishlist/get` answers. */
export type WishlistRow = {
  id: number;
  user_id: number;
  book_uuid: string;
  added_at: number;
  source: "scan" | "detail" | "manual";
};

export const SAMPLE_COPY: CopyRow = {
  id: 42,
  book_uuid: "uuid",
  isbn: "9780262033848",
  added_by_user_id: 1,
  checked_in_at: 1_700_000_000,
  note: "Trade paperback, MIT Press",
};

export const SAMPLE_WISHLIST_ENTRY: WishlistRow = {
  id: 7,
  user_id: 1,
  book_uuid: "uuid",
  added_at: 1_700_000_000,
  source: "detail",
};
