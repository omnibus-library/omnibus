import {
  type ExpectMutationOptions,
  type ForcedRequest,
  post,
} from "../utils/api";

/** The library search, which the palette and the results page both read. */
export const searchUrls = {
  palette: /\/api\/search\/palette(?:\?|$)/,
};

/** The searches the palette and the results page run. */
export const search = {
  /** The library search; a query also pins the body, none leaves it unchecked. */
  palette: (query?: string): ExpectMutationOptions =>
    post(searchUrls.palette, query === undefined ? undefined : { q: query }),

  /** The library search as a read a test can force to fail. */
  read: (): ForcedRequest => ({ method: "GET", url: searchUrls.palette }),
};
