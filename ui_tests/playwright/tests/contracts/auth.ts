import { type ExpectMutationOptions, post } from "../utils/api";

/** The sign-in endpoints the auth pages and the user menu talk to. */
export const authUrls = {
  login: /\/api\/auth\/login(?:\?|$)/,
  logout: /\/api\/auth\/logout(?:\?|$)/,
  register: /\/api\/auth\/register(?:\?|$)/,
  registration: /\/api\/auth\/registration(?:\?|$)/,
};

/** The writes a reader makes to start and end a session, or to sign up. */
export const auth = {
  login: (status = 200): ExpectMutationOptions =>
    post(authUrls.login, undefined, status),

  logout: (): ExpectMutationOptions => post(authUrls.logout),

  register: (status = 200): ExpectMutationOptions =>
    post(authUrls.register, undefined, status),
};
