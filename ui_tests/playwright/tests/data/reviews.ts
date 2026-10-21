/**
 * The fields `PATCH /api/reviews/{uuid}` changes: one left out stays, one sent
 * as null is cleared.
 */
export type ReviewPatch = {
  stars?: number | null;
  body_md?: string | null;
  notes_md?: string | null;
  spoiler?: boolean;
};

/** Your own review of a book, private notes included. */
export type Review = {
  book_uuid: string;
  stars: number | null;
  body_md: string | null;
  notes_md: string | null;
  spoiler: boolean;
};

/** `GET /api/reviews/{uuid}`, cut to the part the specs read back. */
export type BookReviews = { mine: Review | null };
