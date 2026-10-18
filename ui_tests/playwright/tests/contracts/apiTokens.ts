import type { ExpectMutationOptions } from "../utils/api";

/** The endpoints Settings → API Tokens posts to, hosted MCP switch included. */
export const apiTokensUrls = {
  create: /\/api\/rpc\/api-tokens\/create(?:\?|$)/,
  rename: /\/api\/rpc\/api-tokens\/rename(?:\?|$)/,
  revoke: /\/api\/rpc\/api-tokens\/revoke(?:\?|$)/,
  mcp: /\/api\/settings\/mcp(?:\?|$)/,
};

/** The writes a reader makes to manage tokens and the MCP endpoint. */
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

  setMcp: (enabled: boolean): ExpectMutationOptions => ({
    method: "POST",
    url: apiTokensUrls.mcp,
    expectedBody: { enabled },
    expectedStatus: 204,
  }),
};
