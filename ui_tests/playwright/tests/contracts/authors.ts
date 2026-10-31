import type { ExpectMutationOptions, ForcedRequest } from "../utils/api";

/** The author endpoints: the index a filter menu reads, and an admin's delete. */
export const authorsUrls = {
  list: /\/api\/authors(?:\?|$)/,
  delete: /\/api\/authors\/\d+(?:\?|$)/,
};

export const authors = {
  /** The authors index, which the Author facet's menu lists. */
  list: (): ForcedRequest => ({ method: "GET", url: authorsUrls.list }),

  /** The write an admin makes from an author's page. */
  delete: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: authorsUrls.delete,
    expectedStatus: 204,
  }),
};
