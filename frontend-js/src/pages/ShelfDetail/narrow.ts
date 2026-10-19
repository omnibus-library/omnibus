import type { Book } from "../../api";

/** The page's whole member list and how far its fetch has got. */
export type FullList = {
  books: Book[];
  /** A fetch has succeeded for the shelf on screen. */
  ready: boolean;
  errored: boolean;
};

/** The server's answer to the library filter, for the filter now set. */
export type NarrowedList = {
  /** `undefined` until it answers. */
  books: Book[] | undefined;
  failed: boolean;
};

/** What the member section draws, and which message an empty one gets. */
export type Rows = {
  books: Book[];
  /** The list the rows come from has not answered yet. */
  pending: boolean;
  errored: boolean;
  /** The shelf holds books but the filter rules every one out. */
  filteredOut: boolean;
  /** The rows are the empty placeholder of a failed fetch, so their length counts nothing. */
  unavailable: boolean;
};

/** Chooses the list to draw: under a filter only the server's narrowed answer, never the full list standing in while it is out. */
export function rows(
  filtered: boolean,
  full: FullList,
  narrowed: NarrowedList,
): Rows {
  if (!filtered) {
    return {
      books: full.errored ? [] : full.books,
      // A refetch keeps the books on screen; only a list never answered is unknown.
      pending: !full.ready && full.books.length === 0 && !full.errored,
      errored: full.errored,
      filteredOut: false,
      unavailable: full.errored,
    };
  }
  const books = narrowed.books ?? [];
  const pending = narrowed.books === undefined && !narrowed.failed;
  const shelfIsEmpty = full.ready && full.books.length === 0;
  return {
    books,
    pending,
    errored: full.errored || narrowed.failed,
    filteredOut:
      !pending && !narrowed.failed && books.length === 0 && !shelfIsEmpty,
    unavailable: narrowed.failed,
  };
}
