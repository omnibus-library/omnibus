import type { ExternalBookMeta, WishlistSource } from "../data/scan";
import { expect } from "../fixtures/test";
import type { ExpectMutationOptions } from "../utils/api";

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
  resolve: (isbn: string): ExpectMutationOptions => ({
    method: "POST",
    url: scanUrls.resolve,
    expectedBody: { req: { isbn } },
    expectedStatus: 200,
  }),

  resolveMeta: (meta: ExternalBookMeta): ExpectMutationOptions => ({
    method: "POST",
    url: scanUrls.resolveMeta,
    expectedBody: { req: { meta } },
    expectedStatus: 200,
  }),

  search: (query: string): ExpectMutationOptions => ({
    method: "POST",
    url: scanUrls.search,
    expectedBody: { req: { query } },
    expectedStatus: 200,
  }),

  checkIn: (
    book: { uuid: string; isbn13: string },
    note: string | null = null,
  ): ExpectMutationOptions => ({
    method: "POST",
    url: scanUrls.checkIn,
    expectedBody: { req: { book_uuid: book.uuid, isbn: book.isbn13, note } },
    expectedStatus: 200,
  }),

  physicalOnly: (meta: ExternalBookMeta): ExpectMutationOptions => ({
    method: "POST",
    url: scanUrls.physicalOnly,
    expectedBody: { req: { meta, note: null } },
    expectedStatus: 200,
  }),

  wishlist: (source: WishlistSource): ExpectMutationOptions => ({
    method: "POST",
    url: scanUrls.wishlist,
    expectedBody: { req: expect.objectContaining({ source }) },
    expectedStatus: 200,
  }),

  /** A read that POSTs on page load, not on a click, so it waits longer. */
  googleBooksConfigured: (): ExpectMutationOptions => ({
    method: "POST",
    url: scanUrls.googleBooksConfigured,
    expectedStatus: 200,
    timeout: 15_000,
  }),
};
