import type { ExpectMutationOptions } from "../utils/api";

/** The rating endpoints a book page posts to. */
export const ratingsUrls = {
  set: /\/api\/rpc\/ratings\/set(?:\?|$)/,
  clear: /\/api\/rpc\/ratings\/clear(?:\?|$)/,
  others: /\/api\/rpc\/ratings\/others(?:\?|$)/,
};

/** The writes a reader makes on their own rating of a book. */
export const ratings = {
  set: (bookUuid: string, stars: number): ExpectMutationOptions => ({
    method: "POST",
    url: ratingsUrls.set,
    expectedBody: { update: { book_uuid: bookUuid, stars } },
    expectedStatus: 200,
  }),

  clear: (bookUuid: string): ExpectMutationOptions => ({
    method: "POST",
    url: ratingsUrls.clear,
    expectedBody: { uuid: bookUuid },
    expectedStatus: 200,
  }),
};
