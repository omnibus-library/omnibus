/** Another reader's rating of a book; the server always sends `has_avatar`. */
export type AttributedRating = {
  user_id: number;
  username: string;
  has_avatar: boolean;
  stars: number;
  updated_at: number;
};

/** One book's rating, as `GET /api/ratings/{uuid}` reports it. */
export type RatingRecord = { book_uuid: string; stars: number };
