import type { ExpectMutationOptions } from "../utils/api";

/** The rating endpoints the book page's stars post to, and the read it stubs. */
export const ratingsUrls = {
  set: /\/api\/rpc\/ratings\/set(?:\?|$)/,
  clear: /\/api\/rpc\/ratings\/clear(?:\?|$)/,
  others: /\/api\/rpc\/ratings\/others(?:\?|$)/,
};

/** The writes a reader makes by clicking the rating stars. */
export const ratings = {
  set: (): ExpectMutationOptions => ({
    method: "POST",
    url: ratingsUrls.set,
    expectedStatus: 200,
  }),

  clear: (): ExpectMutationOptions => ({
    method: "POST",
    url: ratingsUrls.clear,
    expectedStatus: 200,
  }),
};
