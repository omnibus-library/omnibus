import type { ExpectMutationOptions } from "../utils/api";

/** The highlight endpoints the reader posts to. */
export const highlightsUrls = {
  create: /\/api\/rpc\/highlights\/create(?:\?|$)/,
  delete: /\/api\/rpc\/highlights\/delete(?:\?|$)/,
  updateNote: /\/api\/rpc\/highlights\/update-note(?:\?|$)/,
  updateColor: /\/api\/rpc\/highlights\/update-color(?:\?|$)/,
};

/** The writes the reader makes on highlights. */
export const highlights = {
  create: (): ExpectMutationOptions => ({
    method: "POST",
    url: highlightsUrls.create,
    expectedStatus: 200,
  }),

  delete: (): ExpectMutationOptions => ({
    method: "POST",
    url: highlightsUrls.delete,
    expectedStatus: 200,
  }),

  updateNote: (): ExpectMutationOptions => ({
    method: "POST",
    url: highlightsUrls.updateNote,
    expectedStatus: 200,
  }),

  updateColor: (): ExpectMutationOptions => ({
    method: "POST",
    url: highlightsUrls.updateColor,
    expectedStatus: 200,
  }),
};
