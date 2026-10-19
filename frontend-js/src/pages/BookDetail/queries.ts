import {
  type QueryClient,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  type BookDetail,
  type BookUuid,
  fetchAlignment,
  fetchBook,
  fetchCopies,
  fetchHighlights,
  fetchInsights,
  fetchJournalEntries,
  fetchProgress,
  fetchReadStatus,
  fetchShelves,
  fetchShelvesContaining,
  fetchSmartShelvesContaining,
  fetchSuggestions,
  fetchWishlist,
  type Suggestions,
} from "../../api";
import type { ShelfFacts } from "./shelves";

// The cached answers more than one stop reads; the keys let a write invalidate by prefix.

export const bookQuery = (uuid: BookUuid) =>
  queryOptions({
    queryKey: ["book", uuid],
    queryFn: () => fetchBook(uuid),
  });

/** Drops every cached answer about a book, for a page that is about to leave it. */
export const forgetBook = (client: QueryClient, uuid: BookUuid) =>
  client.removeQueries({ queryKey: bookQuery(uuid).queryKey });

/** Forgets the book and goes home, for a delete that took the whole book with it. */
export function useLeaveBook(uuid: BookUuid) {
  const client = useQueryClient();
  const navigate = useNavigate();
  return () => {
    forgetBook(client, uuid);
    navigate("/", { replace: true });
  };
}

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
    queryFn: async ({ client }): Promise<ShelfFacts> => {
      const [all, manualIds, smartIds, wishlist] = await Promise.all([
        fetchShelves(),
        fetchShelvesContaining(uuid),
        fetchSmartShelvesContaining(uuid),
        // Through the cache, so a wishlist refetch already under way is shared.
        client.fetchQuery(wishlistQuery(uuid)),
      ]);
      return { all, manualIds, smartIds, wished: wishlist !== null };
    },
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
