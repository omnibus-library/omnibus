import {
  type ExpectMutationOptions,
  type ForcedRequest,
  post,
} from "../utils/api";

/** The author endpoints: the index a filter menu reads, and an admin's delete. */
export const authorsUrls = {
  list: /\/api\/rpc\/authors(?:\?|$)/,
  delete: /\/api\/rpc\/author\/delete(?:\?|$)/,
};

export const authors = {
  /** The authors index, which the Author facet's menu lists. */
  list: (): ForcedRequest => ({ method: "GET", url: authorsUrls.list }),

  /** The write an admin makes from an author's page. */
  delete: (): ExpectMutationOptions => post(authorsUrls.delete),
};
