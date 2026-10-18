import type { NewUser } from "../data/users";
import type { ExpectMutationOptions } from "../utils/api";

/** The endpoints the Users section and its self-registration switch call. */
export const usersUrls = {
  create: /\/api\/admin\/users(?:\?|$)/,
  byId: /\/api\/admin\/users\/\d+(?:\?|$)/,
  registration: /\/api\/settings\/registration(?:\?|$)/,
  registrationStatus: /\/api\/auth\/registration(?:\?|$)/,
};

/** The writes an admin makes from the Users section. */
export const users = {
  create: (user: NewUser): ExpectMutationOptions => ({
    method: "POST",
    url: usersUrls.create,
    expectedBody: user,
    expectedStatus: 201,
  }),

  /** The 409 the server answers a create with when the username is taken. */
  createConflict: (): ExpectMutationOptions => ({
    method: "POST",
    url: usersUrls.create,
    expectedStatus: 409,
  }),

  delete: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: usersUrls.byId,
    expectedStatus: 204,
  }),

  setRegistration: (enabled: boolean): ExpectMutationOptions => ({
    method: "POST",
    url: usersUrls.registration,
    expectedBody: { enabled },
    expectedStatus: 204,
  }),
};
