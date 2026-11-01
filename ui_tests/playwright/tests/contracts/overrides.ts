import { type ExpectMutationOptions, post } from "../utils/api";

/** One book's overrides: `POST` saves its edits, `DELETE` reverts them. */
const BOOK = /\/api\/ebooks\/[^/?]+\/overrides(?:\?|$)/;

/** The metadata override endpoints; each URL excludes the others' suffixes. */
export const overridesUrls = {
  save: BOOK,
  bulkSave: /\/api\/ebooks\/overrides\/bulk(?:\?|$)/,
  revert: BOOK,
};

/** The writes that change a book's metadata overrides; no body leaves it unchecked. */
export const overrides = {
  save: (body?: unknown): ExpectMutationOptions =>
    post(overridesUrls.save, body),

  bulkSave: (body?: unknown): ExpectMutationOptions =>
    post(overridesUrls.bulkSave, body, 204),

  revert: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: overridesUrls.revert,
    expectedStatus: 200,
  }),
};
