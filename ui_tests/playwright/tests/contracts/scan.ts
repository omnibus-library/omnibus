import type { ExternalBookMeta, WishlistSource } from "../data/scan";
import { expect } from "../fixtures/test";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The scan endpoints the check-in flow posts to. */
export const scanUrls = {
  resolve: /\/api\/rpc\/scan\/resolve$/,
  resolveMeta: /\/api\/rpc\/scan\/resolve-meta$/,
  search: /\/api\/rpc\/scan\/search$/,
  checkIn: /\/api\/rpc\/scan\/check-in$/,
  physicalOnly: /\/api\/rpc\/scan\/physical-only$/,
  wishlist: /\/api\/rpc\/scan\/wishlist$/,
  googleBooksConfigured: /\/api\/rpc\/scan\/google-books-configured$/,
};

/**
 * The request each check-in action must send, for `expectMutation`. Dioxus
 * keys a server-fn body by its parameter name, so `req` wraps each one.
 */
export const scan = {
  resolve: (isbn: string): ExpectMutationOptions =>
    post(scanUrls.resolve, { req: { isbn } }),

  resolveMeta: (meta: ExternalBookMeta): ExpectMutationOptions =>
    post(scanUrls.resolveMeta, { req: { meta } }),

  search: (query: string): ExpectMutationOptions =>
    post(scanUrls.search, { req: { query } }),

  checkIn: (
    book: { uuid: string; isbn13: string },
    note: string | null = null,
  ): ExpectMutationOptions =>
    post(scanUrls.checkIn, {
      req: { book_uuid: book.uuid, isbn: book.isbn13, note },
    }),

  physicalOnly: (meta: ExternalBookMeta): ExpectMutationOptions =>
    post(scanUrls.physicalOnly, { req: { meta, note: null } }),

  wishlist: (source: WishlistSource): ExpectMutationOptions =>
    post(scanUrls.wishlist, { req: expect.objectContaining({ source }) }),

  /** A read that POSTs on page load, not on a click, so it waits longer. */
  googleBooksConfigured: (): ExpectMutationOptions => ({
    ...post(scanUrls.googleBooksConfigured),
    timeout: 15_000,
  }),
};
