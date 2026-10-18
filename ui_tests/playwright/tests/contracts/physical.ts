import type { ExpectMutationOptions } from "../utils/api";

/** The physical-copy endpoints a book page posts to. */
export const physicalUrls = {
  deleteCopy: /\/api\/rpc\/physical\/copies\/delete$/,
  deleteBook: /\/api\/rpc\/physical\/book\/delete$/,
  copies: /\/api\/rpc\/physical\/copies(?:\?|$)/,
  wishlistGet: /\/api\/rpc\/physical\/wishlist\/get(?:\?|$)/,
  wishlistAdd: /\/api\/rpc\/physical\/wishlist\/add(?:\?|$)/,
  wishlistRemove: /\/api\/rpc\/physical\/wishlist\/remove(?:\?|$)/,
  copyNote: /\/api\/rpc\/physical\/copies\/note(?:\?|$)/,
};

/** The writes a book page makes against its physical copies. */
export const physical = {
  deleteCopy: (): ExpectMutationOptions => ({
    method: "POST",
    url: physicalUrls.deleteCopy,
    expectedStatus: 200,
  }),

  deleteBook: (bookUuid: string): ExpectMutationOptions => ({
    method: "POST",
    url: physicalUrls.deleteBook,
    expectedBody: { uuid: bookUuid },
    expectedStatus: 200,
  }),

  /** The panel's load of a book's copies, which a spec fails or stubs. */
  copies: (): ExpectMutationOptions => ({
    method: "POST",
    url: physicalUrls.copies,
    expectedStatus: 200,
  }),

  wishlistAdd: (): ExpectMutationOptions => ({
    method: "POST",
    url: physicalUrls.wishlistAdd,
    expectedStatus: 200,
  }),

  wishlistRemove: (): ExpectMutationOptions => ({
    method: "POST",
    url: physicalUrls.wishlistRemove,
    expectedStatus: 200,
  }),

  copyNote: (): ExpectMutationOptions => ({
    method: "POST",
    url: physicalUrls.copyNote,
    expectedStatus: 200,
  }),
};
