import type { ExpectMutationOptions } from "../utils/api";

/** The physical-copy endpoints a book page calls; each names the book or copy in its path. */
export const physicalUrls = {
  copy: /\/api\/physical\/copies\/\d+$/,
  book: /\/api\/physical\/[^/]+$/,
  copies: /\/api\/physical\/[^/]+\/copies$/,
  wishlist: /\/api\/physical\/[^/]+\/wishlist$/,
};

/** The requests a book page makes against its physical copies. */
export const physical = {
  deleteCopy: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: physicalUrls.copy,
    expectedStatus: 204,
  }),

  deleteBook: (bookUuid: string): ExpectMutationOptions => ({
    method: "DELETE",
    url: new RegExp(`/api/physical/${bookUuid}$`),
    expectedStatus: 204,
  }),

  /** The panel's load of a book's copies, which a spec fails or stubs. */
  copies: () => ({ method: "GET", url: physicalUrls.copies }) as const,

  wishlistAdd: (): ExpectMutationOptions => ({
    method: "POST",
    url: physicalUrls.wishlist,
    expectedStatus: 200,
  }),

  wishlistRemove: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: physicalUrls.wishlist,
    expectedStatus: 200,
  }),

  copyNote: (): ExpectMutationOptions => ({
    method: "PATCH",
    url: physicalUrls.copy,
    expectedStatus: 200,
  }),
};
