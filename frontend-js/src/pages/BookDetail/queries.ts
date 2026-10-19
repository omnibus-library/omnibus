import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import {
  type AuthorId,
  type BookDetail,
  type BookUuid,
  fetchAlignment,
  fetchAuthorBooks,
  fetchCopies,
  fetchHighlights,
  fetchInsights,
  fetchJournalEntries,
  fetchProgress,
  fetchReadStatus,
  fetchSeries,
  fetchShelves,
  fetchShelvesContaining,
  fetchSmartShelvesContaining,
  fetchSuggestions,
  fetchWishlist,
  type SeriesId,
  type Suggestions,
} from "../../api";
import type { ShelfFacts } from "./shelves";

// The cached answers more than one stop reads; the keys let a write invalidate by prefix.

export const seriesQuery = (id: SeriesId | null) =>
  queryOptions({
    queryKey: ["series", id],
    queryFn: id === null ? skipToken : () => fetchSeries(id),
  });

export const progressQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "progress"],
    queryFn: () => fetchProgress(uuid),
  });

export const alignmentQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "alignment"],
    queryFn: () => fetchAlignment(uuid),
  });

export const readStatusQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "readStatus"],
    queryFn: () => fetchReadStatus(uuid),
  });

export const highlightsQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "highlights"],
    queryFn: () => fetchHighlights(uuid),
  });

export const journalQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "journal"],
    queryFn: () => fetchJournalEntries(uuid),
  });

export const copiesQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "copies"],
    queryFn: () => fetchCopies(uuid),
  });

export const wishlistQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "wishlist"],
    queryFn: () => fetchWishlist(uuid),
  });

/** The reader's wishlist entry for a book with no files, which the page draws as a wish; else `null`. */
export function useWish(book: BookDetail) {
  const wish = useQuery({
    ...wishlistQuery(book.uuid),
    enabled: book.formats.length === 0,
  });
  return wish.data ?? null;
}

/** The shelf list, the shelves holding the book by hand and by rule, and whether it is wished: one read, so they agree. */
export const shelvesQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "shelves"],
    queryFn: async (): Promise<ShelfFacts> => {
      const [all, manualIds, smartIds, wishlist] = await Promise.all([
        fetchShelves(),
        fetchShelvesContaining(uuid),
        fetchSmartShelvesContaining(uuid),
        fetchWishlist(uuid),
      ]);
      return { all, manualIds, smartIds, wished: wishlist !== null };
    },
  });

export const authorBooksQuery = (id: AuthorId | null) =>
  queryOptions({
    queryKey: ["author", id],
    queryFn: id === null ? skipToken : () => fetchAuthorBooks(id),
  });

const SUGGESTION_POLL_MS = 2500;
/** How many times a still-pending answer is asked for again before it settles as empty. */
export const SUGGESTION_POLLS = 5;

/** The wait before asking again: while the server is still fetching, up to {@link SUGGESTION_POLLS} more times. */
export const suggestionPollMs = (
  data: Suggestions | undefined,
  answers: number,
) =>
  data?.status === "pending" && answers <= SUGGESTION_POLLS
    ? SUGGESTION_POLL_MS
    : false;

export const suggestionsQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "suggestions"],
    queryFn: () => fetchSuggestions(uuid),
    // A repeated "pending" must still reach the screen, which counts the answers.
    structuralSharing: false,
    refetchInterval: (query) =>
      suggestionPollMs(query.state.data, query.state.dataUpdateCount),
  });

export const insightsQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid, "insights"],
    queryFn: () => fetchInsights(uuid),
  });
