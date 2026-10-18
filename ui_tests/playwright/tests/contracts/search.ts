import type { ExpectMutationOptions } from "../utils/api";

/** The search endpoints; both are server functions, so reads arrive as POSTs. */
export const searchUrls = {
  palette: /\/api\/rpc\/search-palette(?:\?|$)/,
  results: /\/api\/rpc\/search-results(?:\?|$)/,
};

/** The searches the palette and the results page run. */
export const search = {
  palette: (): ExpectMutationOptions => ({
    method: "POST",
    url: searchUrls.palette,
    expectedStatus: 200,
  }),

  /** The fetch behind a section's Show all; no body leaves it unchecked. */
  results: (body?: { q: string; limit: number }): ExpectMutationOptions => ({
    method: "POST",
    url: searchUrls.results,
    expectedBody: body,
    expectedStatus: 200,
  }),
};
