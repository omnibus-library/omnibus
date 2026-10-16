import type { ExpectMutationOptions } from "../utils/api";

/** The physical-copy endpoints a book page posts to. */
export const physicalUrls = {
  deleteCopy: /\/api\/rpc\/physical\/copies\/delete$/,
  deleteBook: /\/api\/rpc\/physical\/book\/delete$/,
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
};
