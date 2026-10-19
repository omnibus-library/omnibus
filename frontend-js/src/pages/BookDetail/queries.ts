import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import {
  type BookDetail,
  type BookUuid,
  fetchAlignment,
  fetchCopies,
  fetchHighlights,
  fetchJournalEntries,
  fetchProgress,
  fetchReadStatus,
  fetchSeries,
  fetchWishlist,
  type SeriesId,
} from "../../api";

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
