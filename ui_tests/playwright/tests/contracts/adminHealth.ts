import type { ExpectMutationOptions } from "../utils/api";

/** The endpoint the admin health page polls. */
export const adminHealthUrls = {
  poll: /\/api\/rpc\/admin-health(?:\?|$)/,
};

/** The reads the admin health page makes. */
export const adminHealth = {
  /**
   * The poll loop skips its first tick until the signed-in user resolves, so
   * the first request lands a full interval after mount.
   */
  poll: (): ExpectMutationOptions => ({
    method: "POST",
    url: adminHealthUrls.poll,
    expectedStatus: 200,
    timeout: 12_000,
  }),
};
