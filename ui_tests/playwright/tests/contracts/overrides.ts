import type { ExpectMutationOptions } from "../utils/api";

/** The metadata override endpoints; each URL excludes the others' suffixes. */
export const overridesUrls = {
  save: /\/api\/rpc\/ebook\/overrides(?:\?|$)/,
  bulkSave: /\/api\/rpc\/ebook\/overrides\/bulk(?:\?|$)/,
  revert: /\/api\/rpc\/ebook\/overrides\/delete(?:\?|$)/,
};

function overrideWrite(url: RegExp, body?: unknown): ExpectMutationOptions {
  return { method: "POST", url, expectedBody: body, expectedStatus: 200 };
}

/** The writes that change a book's metadata overrides; no body leaves it unchecked. */
export const overrides = {
  save: (body?: unknown): ExpectMutationOptions =>
    overrideWrite(overridesUrls.save, body),

  bulkSave: (body?: unknown): ExpectMutationOptions =>
    overrideWrite(overridesUrls.bulkSave, body),

  revert: (body?: unknown): ExpectMutationOptions =>
    overrideWrite(overridesUrls.revert, body),
};
