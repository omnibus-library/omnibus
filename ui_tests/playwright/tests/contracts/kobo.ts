import type { DeviceKind } from "../data/account";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The sync device endpoints Settings › Devices reads and writes. */
export const koboUrls = {
  list: /\/api\/account\/kobo-devices(?:\?|$)/,
  regenerate: /\/api\/account\/kobo-devices\/\d+\/regenerate(?:\?|$)/,
  create: /\/api\/account\/kobo-devices(?:\?|$)/,
  revoke: /\/api\/account\/kobo-devices\/\d+(?:\?|$)/,
};

/** The writes a reader makes to add and remove a sync device. */
export const kobo = {
  create: (name: string, kind: DeviceKind = "kobo"): ExpectMutationOptions =>
    post(koboUrls.create, { name, kind }),

  revoke: (id: number): ExpectMutationOptions => ({
    method: "DELETE",
    url: new RegExp(`/api/account/kobo-devices/${id}(?:\\?|$)`),
    expectedStatus: 204,
  }),
};
