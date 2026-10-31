import type { ExpectMutationOptions } from "../utils/api";

/** The endpoint behind the suggestions strip. */
export const suggestionsUrls = {
  fetch: /\/api\/ebooks\/[^/?]+\/suggestions(?:\?|$)/,
};

/** The strip's own fetch. */
export const suggestions = {
  /** A GET the book page makes once its book has loaded. */
  fetch: (): ExpectMutationOptions => ({
    method: "GET",
    url: suggestionsUrls.fetch,
    timeout: 30_000,
  }),
};
