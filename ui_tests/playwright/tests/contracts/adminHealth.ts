import { type ExpectMutationOptions, get } from "../utils/api";

/** The endpoint the admin health page polls. */
export const adminHealthUrls = {
  poll: /\/api\/admin\/health(?:\?|$)/,
};

/** The reads the admin health page makes. */
export const adminHealth = {
  /** The read the section makes on mount and every five seconds after. */
  poll: (): ExpectMutationOptions => get(adminHealthUrls.poll),
};
