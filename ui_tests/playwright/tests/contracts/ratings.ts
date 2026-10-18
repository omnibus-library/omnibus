import { type ExpectMutationOptions, post } from "../utils/api";

/** The rating endpoints the book page's stars post to, and the read it stubs. */
export const ratingsUrls = {
  set: /\/api\/rpc\/ratings\/set(?:\?|$)/,
  clear: /\/api\/rpc\/ratings\/clear(?:\?|$)/,
  others: /\/api\/rpc\/ratings\/others(?:\?|$)/,
};

/** The writes a reader makes on their own rating of a book. */
export const ratings = {
  set: (bookUuid: string, stars: number): ExpectMutationOptions =>
    post(ratingsUrls.set, { update: { book_uuid: bookUuid, stars } }),

  clear: (bookUuid: string): ExpectMutationOptions =>
    post(ratingsUrls.clear, { uuid: bookUuid }),
};
