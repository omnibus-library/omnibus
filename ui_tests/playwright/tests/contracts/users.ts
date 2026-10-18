import type { NewUser } from "../data/users";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The endpoints the Users section and its self-registration switch call. */
export const usersUrls = {
  create: /\/api\/admin\/users(?:\?|$)/,
  byId: /\/api\/admin\/users\/\d+(?:\?|$)/,
  registration: /\/api\/settings\/registration(?:\?|$)/,
};

/** The writes an admin makes from the Users section. */
export const users = {
  create: (user: NewUser): ExpectMutationOptions =>
    post(usersUrls.create, user, 201),

  /** The 409 the server answers a create with when the username is taken. */
  createConflict: (): ExpectMutationOptions =>
    post(usersUrls.create, undefined, 409),

  delete: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: usersUrls.byId,
    expectedStatus: 204,
  }),

  setRegistration: (enabled: boolean): ExpectMutationOptions =>
    post(usersUrls.registration, { enabled }, 204),
};
