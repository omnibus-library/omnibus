import { type ExpectMutationOptions, post } from "../utils/api";

/** The search endpoints; both are server functions, so reads arrive as POSTs. */
export const searchUrls = {
  palette: /\/api\/rpc\/search-palette(?:\?|$)/,
  results: /\/api\/rpc\/search-results(?:\?|$)/,
};

/** The searches the palette and the results page run. */
export const search = {
  /** The library search; a query also pins the body, none leaves it unchecked. */
  palette: (query?: string): ExpectMutationOptions =>
    post(searchUrls.palette, query === undefined ? undefined : { q: query }),

  /** The fetch behind a section's Show all; no body leaves it unchecked. */
  results: (body?: { q: string; limit: number }): ExpectMutationOptions =>
    post(searchUrls.results, body),
};
