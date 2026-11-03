import type { ExternalBookMeta, WishlistSource } from "../data/scan";
import { expect } from "../fixtures/test";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The scan endpoints the check-in flow calls; the key status is a GET. */
export const scanUrls = {
  resolve: /\/api\/scan\/resolve$/,
  resolveMeta: /\/api\/scan\/resolve-meta$/,
  search: /\/api\/scan\/search$/,
  checkIn: /\/api\/scan\/check-in$/,
  physicalOnly: /\/api\/scan\/physical-only$/,
  wishlist: /\/api\/scan\/wishlist$/,
  googleBooksConfigured: /\/api\/scan\/google-books-configured$/,
};

/** The request each check-in action must send, for `expectMutation`. */
export const scan = {
  resolve: (isbn: string): ExpectMutationOptions =>
    post(scanUrls.resolve, { isbn }),

  resolveMeta: (meta: ExternalBookMeta): ExpectMutationOptions =>
    post(scanUrls.resolveMeta, { meta }),

  search: (query: string): ExpectMutationOptions =>
    post(scanUrls.search, { query }),

  checkIn: (
    book: { uuid: string; isbn13: string },
    note?: string,
  ): ExpectMutationOptions =>
    post(scanUrls.checkIn, {
      book_uuid: book.uuid,
      isbn: book.isbn13,
      note,
    }),

  physicalOnly: (meta: ExternalBookMeta): ExpectMutationOptions =>
    post(scanUrls.physicalOnly, { meta }),

  wishlist: (source: WishlistSource): ExpectMutationOptions =>
    post(scanUrls.wishlist, expect.objectContaining({ source })),
};
