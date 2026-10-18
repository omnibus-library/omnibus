import { type ExpectMutationOptions, post } from "../utils/api";

/** The metadata override endpoints; each URL excludes the others' suffixes. */
export const overridesUrls = {
  save: /\/api\/rpc\/ebook\/overrides(?:\?|$)/,
  bulkSave: /\/api\/rpc\/ebook\/overrides\/bulk(?:\?|$)/,
  revert: /\/api\/rpc\/ebook\/overrides\/delete(?:\?|$)/,
};

/** The writes that change a book's metadata overrides; no body leaves it unchecked. */
export const overrides = {
  save: (body?: unknown): ExpectMutationOptions =>
    post(overridesUrls.save, body),

  bulkSave: (body?: unknown): ExpectMutationOptions =>
    post(overridesUrls.bulkSave, body),

  revert: (body?: unknown): ExpectMutationOptions =>
    post(overridesUrls.revert, body),
};
