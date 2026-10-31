import type { ExpectMutationOptions, MutationMethod } from "../utils/api";

/** The highlight endpoints the reader writes to. */
export const highlightsUrls = {
  create: /\/api\/highlights(?:\?|$)/,
  delete: /\/api\/highlights\/\d+(?:\?|$)/,
  updateNote: /\/api\/highlights\/\d+\/note(?:\?|$)/,
  updateColor: /\/api\/highlights\/\d+\/color(?:\?|$)/,
};

const write = (method: MutationMethod, url: RegExp): ExpectMutationOptions => ({
  method,
  url,
});

/** The writes the reader makes on highlights. */
export const highlights = {
  create: (): ExpectMutationOptions => write("POST", highlightsUrls.create),

  delete: (): ExpectMutationOptions => write("DELETE", highlightsUrls.delete),

  updateNote: (): ExpectMutationOptions =>
    write("PATCH", highlightsUrls.updateNote),

  updateColor: (): ExpectMutationOptions =>
    write("PATCH", highlightsUrls.updateColor),
};
