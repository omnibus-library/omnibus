import type { ExpectMutationOptions } from "../utils/api";

/** The endpoints the reader's highlights drawer posts to. */
export const highlightsUrls = {
  delete: /\/api\/rpc\/highlights\/delete(?:\?|$)/,
  updateNote: /\/api\/rpc\/highlights\/update-note(?:\?|$)/,
  updateColor: /\/api\/rpc\/highlights\/update-color(?:\?|$)/,
};

/** The writes the highlights drawer makes. */
export const highlights = {
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
