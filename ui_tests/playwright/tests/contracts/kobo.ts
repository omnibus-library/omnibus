import type { ExpectMutationOptions } from "../utils/api";

/** The Kobo device endpoints Settings → Kobo posts to. */
export const koboUrls = {
  create: /\/api\/rpc\/kobo\/devices\/create(?:\?|$)/,
  revoke: /\/api\/rpc\/kobo\/devices\/revoke(?:\?|$)/,
};

/** The writes a reader makes to add and remove a Kobo device. */
export const kobo = {
  create: (name: string): ExpectMutationOptions => ({
    method: "POST",
    url: koboUrls.create,
    expectedBody: { name },
    expectedStatus: 200,
  }),

  revoke: (id: number): ExpectMutationOptions => ({
    method: "POST",
    url: koboUrls.revoke,
    expectedBody: { id },
    expectedStatus: 200,
  }),
};
