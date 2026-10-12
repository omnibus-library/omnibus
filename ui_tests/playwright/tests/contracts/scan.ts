import type { ExpectMutationOptions } from "../utils/api";

/** The scan endpoints the check-in flow posts to. */
export const scanUrls = {
  resolve: /\/api\/rpc\/scan\/resolve$/,
  checkIn: /\/api\/rpc\/scan\/check-in$/,
  wishlist: /\/api\/rpc\/scan\/wishlist$/,
};

/** The request each check-in action must send, for `expectMutation`. */
export const scan = {
  resolve: (): ExpectMutationOptions => ({
    method: "POST",
    url: scanUrls.resolve,
    expectedStatus: 200,
  }),

  checkIn: (book: { uuid: string; isbn13: string }): ExpectMutationOptions => ({
    method: "POST",
    url: scanUrls.checkIn,
    expectedBody: { req: { book_uuid: book.uuid, isbn: book.isbn13, note: null } },
    expectedStatus: 200,
  }),

  wishlist: (): ExpectMutationOptions => ({
    method: "POST",
    url: scanUrls.wishlist,
    expectedStatus: 200,
  }),
};
