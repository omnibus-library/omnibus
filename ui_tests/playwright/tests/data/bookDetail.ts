/** One row of `POST /api/rpc/ratings/others`: another reader's rating of the book. */
export type OtherRating = {
  user_id: number;
  username: string;
  stars: number;
  updated_at: number;
};

/** A read-alike the suggestions strip renders; the cover is left off. */
export type SuggestionItem = {
  hardcover_id: number;
  hardcover_url: string;
  title: string;
  author: string;
  list_count: number;
  cover_url: string | null;
};

/** The three answers `POST /api/rpc/ebook-suggestions` gives the strip. */
export type SuggestionsResponse =
  | { status: "not_configured" }
  | { status: "pending" }
  | { status: "ready"; items: SuggestionItem[] };

/** The suggestion ranked `rank`, titled and authored so no two share a name. */
export function mockSuggestion(rank: number): SuggestionItem {
  return {
    hardcover_id: 1000 + rank,
    hardcover_url: `https://hardcover.app/books/mock-${rank}`,
    title: `Suggested Book ${rank}`,
    author: `Suggested Author ${rank}`,
    list_count: rank + 1,
    cover_url: null,
  };
}

/** The fields of `GET /api/ebooks/{uuid}` that the book detail specs read. */
export type BookRecord = {
  genres?: string[];
  subjects: string[];
  book_files: { id: number; format: string }[];
};

/** Whether a `book_files` format is one of the audiobook containers. */
export function isAudioFormat(format: string): boolean {
  return /^(mp3|m4b|m4a)$/i.test(format);
}
