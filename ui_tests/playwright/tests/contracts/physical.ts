import { type ExpectMutationOptions, post } from "../utils/api";

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
  deleteCopy: (): ExpectMutationOptions => post(physicalUrls.deleteCopy),

  deleteBook: (bookUuid: string): ExpectMutationOptions =>
    post(physicalUrls.deleteBook, { uuid: bookUuid }),

  /** The panel's load of a book's copies, which a spec fails or stubs. */
  copies: (): ExpectMutationOptions => post(physicalUrls.copies),

  wishlistAdd: (): ExpectMutationOptions => post(physicalUrls.wishlistAdd),

  wishlistRemove: (): ExpectMutationOptions =>
    post(physicalUrls.wishlistRemove),

  copyNote: (): ExpectMutationOptions => post(physicalUrls.copyNote),
};
