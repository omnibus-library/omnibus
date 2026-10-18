import type { ExpectMutationOptions } from "../utils/api";

/** The sign-in endpoints the auth pages and the user menu talk to. */
export const authUrls = {
  login: /\/api\/auth\/login(?:\?|$)/,
  logout: /\/api\/auth\/logout(?:\?|$)/,
  register: /\/api\/auth\/register(?:\?|$)/,
  registration: /\/api\/auth\/registration(?:\?|$)/,
};

/** The writes a reader makes to start and end a session, or to sign up. */
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

  register: (status = 200): ExpectMutationOptions => ({
    method: "POST",
    url: authUrls.register,
    expectedStatus: status,
  }),
};
