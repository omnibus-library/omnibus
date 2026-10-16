import type { ExpectMutationOptions } from "../utils/api";

/** The search palette endpoint the link picker posts to. */
export const paletteUrls = {
  search: /\/api\/rpc\/search-palette$/,
};

/** The search palette's library search, a read that POSTs. */
export const palette = {
  search: (query: string): ExpectMutationOptions => ({
    method: "POST",
    url: paletteUrls.search,
    expectedBody: { q: query },
    expectedStatus: 200,
  }),
};
