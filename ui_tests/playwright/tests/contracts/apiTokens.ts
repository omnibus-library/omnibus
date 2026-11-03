import type { ExpectMutationOptions } from "../utils/api";
import { post } from "../utils/api";

/** The endpoints Settings › Sign-in & security calls for API tokens. */
export const apiTokensUrls = {
  create: /\/api\/auth\/api-tokens(?:\?|$)/,
  byId: /\/api\/auth\/api-tokens\/\d+(?:\?|$)/,
};

/** The writes a reader makes to manage tokens. */
export const apiTokens = {
  create: (name: string): ExpectMutationOptions =>
    post(apiTokensUrls.create, { name }),

  rename: (): ExpectMutationOptions => ({
    method: "PATCH",
    url: apiTokensUrls.byId,
    expectedStatus: 204,
  }),

  revoke: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: apiTokensUrls.byId,
    expectedStatus: 204,
  }),
};
