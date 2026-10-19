import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { fetchJson, ok } from "./core";
import {
  addPhysicalOnlyBook,
  addScannedBookToWishlist,
  checkInCopy,
  getSearchPalette,
  resolveIsbn,
  resolveSearchResult,
  searchProvidersByTitle,
} from "./generated/omnibus";
import type {
  AddPhysicalOnlyRequest,
  CheckInRequest,
  ExternalBookMeta,
  PaletteBookHit,
  ScanBook,
  ScanOutcome,
  WishlistAddRequest,
} from "./generated/schemas";

// The check-in flow's reads and writes. Every answer stays wire-shaped: a book or
// provider record goes back out in the next request exactly as it came in.

/** Where an ISBN lands: a library book, a close match, an online record, or nothing. */
export async function resolveBook(isbn: string): Promise<ScanOutcome> {
  return ok(await resolveIsbn({ isbn }));
}

/** Where a title-search candidate lands, matched against the library without a second provider lookup. */
export async function resolveMeta(
  meta: ExternalBookMeta,
): Promise<ScanOutcome> {
  return ok(await resolveSearchResult({ meta }));
}

/** Provider candidates for a title. */
export async function searchProviders(
  query: string,
): Promise<ExternalBookMeta[]> {
  return ok(await searchProvidersByTitle({ query })).results;
}

/** Files a physical copy under a library book; answers with the book's current uuid. */
export async function checkInBook(req: CheckInRequest): Promise<string> {
  return ok(await checkInCopy(req)).book_uuid;
}

/** Creates a book with no files and its first copy; answers with its uuid. */
export async function addPhysicalOnly(
  req: AddPhysicalOnlyRequest,
): Promise<string> {
  return ok(await addPhysicalOnlyBook(req)).book_uuid;
}

/** Puts a library book or an online record on the reader's physical wishlist; answers with its uuid. */
export async function wishlistScanned(
  req: WishlistAddRequest,
): Promise<string> {
  return ok(await addScannedBookToWishlist(req)).book_uuid;
}

/** Whether the server has a Google Books key; a failed read is `null`, which shows nothing. */
export const googleBooksConfiguredQuery = queryOptions({
  queryKey: ["google-books-configured"],
  // The route is documented as text/plain, so the generated client has no fetcher for it.
  queryFn: () =>
    fetchJson("/api/scan/google-books-configured", z.boolean()).catch(
      () => null,
    ),
  staleTime: Number.POSITIVE_INFINITY,
});

/**
 * A library-search hit as the confirm screen renders a book. `author_display` stays one
 * entry, not split on ", ", because a sort-form name ("Weir, Andy") carries that separator.
 */
export function scanBookFromHit(
  hit: PaletteBookHit & { uuid: string },
): ScanBook {
  const display = hit.author_display.trim();
  return {
    uuid: hit.uuid,
    title: hit.title,
    authors: display ? [display] : [],
    cover_url: hit.cover_url,
    has_physical: hit.has_physical ?? false,
    has_files: hit.formats.length > 0,
    isbn: null,
  };
}

/** The library's books matching `query`, and how many matched before the list was cut. */
export async function searchLibraryBooks(
  query: string,
): Promise<{ books: ScanBook[]; total: number }> {
  const found = ok(await getSearchPalette({ q: query }));
  const books = found.books.flatMap((hit) =>
    hit.uuid ? [scanBookFromHit({ ...hit, uuid: hit.uuid })] : [],
  );
  return { books, total: found.book_total ?? books.length };
}
