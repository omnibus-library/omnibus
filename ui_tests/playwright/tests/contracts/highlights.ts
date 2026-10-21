import { type ExpectMutationOptions, post } from "../utils/api";

/** The highlight endpoints the reader posts to. */
export const highlightsUrls = {
  create: /\/api\/rpc\/highlights\/create(?:\?|$)/,
  delete: /\/api\/rpc\/highlights\/delete(?:\?|$)/,
  updateNote: /\/api\/rpc\/highlights\/update-note(?:\?|$)/,
  updateColor: /\/api\/rpc\/highlights\/update-color(?:\?|$)/,
};

/** The writes the reader makes on highlights. */
export const highlights = {
  create: (): ExpectMutationOptions => post(highlightsUrls.create),

  delete: (): ExpectMutationOptions => post(highlightsUrls.delete),

  updateNote: (): ExpectMutationOptions => post(highlightsUrls.updateNote),

  updateColor: (): ExpectMutationOptions => post(highlightsUrls.updateColor),
};
