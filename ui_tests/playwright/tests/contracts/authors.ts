import { type ExpectMutationOptions, post } from "../utils/api";

/** The author endpoint an admin's page posts to. */
export const authorsUrls = {
  delete: /\/api\/rpc\/author\/delete(?:\?|$)/,
};

/** The write an admin makes from an author's page. */
export const authors = {
  delete: (): ExpectMutationOptions => post(authorsUrls.delete),
};
