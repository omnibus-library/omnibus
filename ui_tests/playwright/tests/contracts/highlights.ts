import type { ExpectMutationOptions, MutationMethod } from "../utils/api";

/** The highlight endpoints the reader and the book page write to. */
export const highlightsUrls = {
  create: /\/api\/highlights(?:\?|$)/,
  delete: /\/api\/highlights\/\d+(?:\?|$)/,
  updateNote: /\/api\/highlights\/\d+\/note(?:\?|$)/,
  updateColor: /\/api\/highlights\/\d+\/color(?:\?|$)/,
};

const write = (
  method: MutationMethod,
  url: RegExp,
  expectedStatus?: number,
): ExpectMutationOptions => ({ method, url, expectedStatus });

/** The writes the reader makes on highlights. */
export const highlights = {
  create: (): ExpectMutationOptions => write("POST", highlightsUrls.create),

  delete: (): ExpectMutationOptions =>
    write("DELETE", highlightsUrls.delete, 204),

  updateNote: (): ExpectMutationOptions =>
    write("PATCH", highlightsUrls.updateNote, 204),

  updateColor: (): ExpectMutationOptions =>
    write("PATCH", highlightsUrls.updateColor, 204),
};
