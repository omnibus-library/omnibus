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
