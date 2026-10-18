import type { ExpectMutationOptions } from "../utils/api";

/** The sign-in endpoints the login page and the user menu post to. */
export const authUrls = {
  login: /\/api\/auth\/login(?:\?|$)/,
  logout: /\/api\/auth\/logout(?:\?|$)/,
};

/** The writes a reader makes to start and end a session. */
export const auth = {
  login: (status = 200): ExpectMutationOptions => ({
    method: "POST",
    url: authUrls.login,
    expectedStatus: status,
  }),

  logout: (): ExpectMutationOptions => ({
    method: "POST",
    url: authUrls.logout,
    expectedStatus: 200,
  }),
};
