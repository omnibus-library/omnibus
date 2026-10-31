import type { ExpectMutationOptions } from "../utils/api";

/** The metadata override endpoints; each URL excludes the others' suffixes. */
export const overridesUrls = {
  save: /\/api\/ebooks\/[^/?]+\/overrides(?:\?|$)/,
  bulkSave: /\/api\/ebooks\/overrides\/bulk(?:\?|$)/,
  revert: /\/api\/ebooks\/[^/?]+\/overrides(?:\?|$)/,
};

/** The writes that change a book's metadata overrides; no body leaves it unchecked. */
export const overrides = {
  save: (body?: unknown): ExpectMutationOptions => ({
    method: "POST",
    url: overridesUrls.save,
    expectedBody: body,
    expectedStatus: 200,
  }),

  bulkSave: (body?: unknown): ExpectMutationOptions => ({
    method: "POST",
    url: overridesUrls.bulkSave,
    expectedBody: body,
    expectedStatus: 204,
  }),

  /** A DELETE that drops every override the book holds. */
  revert: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: overridesUrls.revert,
    expectedStatus: 200,
  }),
};
