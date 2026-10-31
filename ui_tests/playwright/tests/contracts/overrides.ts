import { type ExpectMutationOptions, post } from "../utils/api";

/** The metadata override endpoints; save and revert share a path and differ by method. */
export const overridesUrls = {
  save: /\/api\/ebooks\/[^/]+\/overrides(?:\?|$)/,
  bulkSave: /\/api\/rpc\/ebook\/overrides\/bulk(?:\?|$)/,
  revert: /\/api\/ebooks\/[^/]+\/overrides(?:\?|$)/,
};

/** The writes that change a book's metadata overrides; no body leaves it unchecked. */
export const overrides = {
  save: (body?: unknown): ExpectMutationOptions =>
    post(overridesUrls.save, body),

  bulkSave: (body?: unknown): ExpectMutationOptions =>
    post(overridesUrls.bulkSave, body),

  /** Drops every override; the uuid is in the path, so there is no body. */
  revert: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: overridesUrls.revert,
    expectedStatus: 200,
  }),
};
