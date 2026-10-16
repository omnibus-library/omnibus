import type { ExpectMutationOptions } from "../utils/api";

/** The writes a book page makes against its physical copies. */
export const physical = {
  deleteCopy: (): ExpectMutationOptions => ({
    method: "POST",
    url: /\/api\/rpc\/physical\/copies\/delete$/,
    expectedStatus: 200,
  }),

  deleteBook: (bookUuid: string): ExpectMutationOptions => ({
    method: "POST",
    url: /\/api\/rpc\/physical\/book\/delete$/,
    expectedBody: { uuid: bookUuid },
    expectedStatus: 200,
  }),
};
