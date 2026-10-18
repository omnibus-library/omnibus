import { type ExpectMutationOptions, post } from "../utils/api";

/** The rating endpoints the book page's stars post to, and the read it stubs. */
export const ratingsUrls = {
  set: /\/api\/rpc\/ratings\/set(?:\?|$)/,
  clear: /\/api\/rpc\/ratings\/clear(?:\?|$)/,
  others: /\/api\/rpc\/ratings\/others(?:\?|$)/,
};

/** The writes a reader makes by clicking the rating stars. */
export const ratings = {
  set: (): ExpectMutationOptions => post(ratingsUrls.set),

  clear: (): ExpectMutationOptions => post(ratingsUrls.clear),
};
