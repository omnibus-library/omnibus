import type { ExpectMutationOptions } from "../utils/api";

/** The endpoints Settings › Sign-in & security posts to for API tokens. */
export const apiTokensUrls = {
  create: /\/api\/rpc\/api-tokens\/create(?:\?|$)/,
  rename: /\/api\/rpc\/api-tokens\/rename(?:\?|$)/,
  revoke: /\/api\/rpc\/api-tokens\/revoke(?:\?|$)/,
};

/** The writes a reader makes to manage tokens. */
export const apiTokens = {
  create: (name: string): ExpectMutationOptions => ({
    method: "POST",
    url: apiTokensUrls.create,
    expectedBody: { name },
    expectedStatus: 200,
  }),

  rename: (): ExpectMutationOptions => ({
    method: "POST",
    url: apiTokensUrls.rename,
    expectedStatus: 200,
  }),

  revoke: (): ExpectMutationOptions => ({
    method: "POST",
    url: apiTokensUrls.revoke,
    expectedStatus: 200,
  }),
};
