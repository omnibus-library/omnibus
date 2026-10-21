import { type ExpectMutationOptions, post } from "../utils/api";

/** The endpoints Settings › Sign-in & security posts to for API tokens. */
export const apiTokensUrls = {
  create: /\/api\/rpc\/api-tokens\/create(?:\?|$)/,
  rename: /\/api\/rpc\/api-tokens\/rename(?:\?|$)/,
  revoke: /\/api\/rpc\/api-tokens\/revoke(?:\?|$)/,
};

/** The writes a reader makes to manage tokens. */
export const apiTokens = {
  create: (name: string): ExpectMutationOptions =>
    post(apiTokensUrls.create, { name }),

  rename: (): ExpectMutationOptions => post(apiTokensUrls.rename),

  revoke: (): ExpectMutationOptions => post(apiTokensUrls.revoke),
};
