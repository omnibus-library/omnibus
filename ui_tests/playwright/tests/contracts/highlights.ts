import type { Response } from "@playwright/test";
import {
  type ExpectMutationOptions,
  type MutationMethod,
  post,
} from "../utils/api";

/** The highlight endpoints the reader and the book page write to. */
export const highlightsUrls = {
  create: /\/api\/highlights(?:\?|$)/,
  delete: /\/api\/highlights\/\d+(?:\?|$)/,
  updateNote: /\/api\/highlights\/\d+\/note(?:\?|$)/,
  updateColor: /\/api\/highlights\/\d+\/color(?:\?|$)/,
};

/** A `waitForResponse` predicate for a `method` request to `url`. */
export const answers =
  (method: MutationMethod, url: RegExp) => (response: Response) =>
    response.request().method() === method && url.test(response.url());

/** The writes the reader makes on highlights. */
export const highlights = {
  create: (): ExpectMutationOptions => post(highlightsUrls.create),

  delete: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: highlightsUrls.delete,
    expectedStatus: 204,
  }),

  updateNote: (): ExpectMutationOptions => ({
    method: "PATCH",
    url: highlightsUrls.updateNote,
    expectedStatus: 204,
  }),

  updateColor: (): ExpectMutationOptions => ({
    method: "PATCH",
    url: highlightsUrls.updateColor,
    expectedStatus: 204,
  }),
};
