import type { DeviceKind } from "../data/account";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The Kobo device endpoints Settings › Devices reads and posts to. */
export const koboUrls = {
  list: /\/api\/rpc\/kobo\/devices(?:\?|$)/,
  regenerate: /\/api\/rpc\/kobo\/devices\/regenerate(?:\?|$)/,
  create: /\/api\/rpc\/kobo\/devices\/create(?:\?|$)/,
  revoke: /\/api\/rpc\/kobo\/devices\/revoke(?:\?|$)/,
};

/** The writes a reader makes to add and remove a sync device. */
export const kobo = {
  create: (name: string, kind: DeviceKind = "kobo"): ExpectMutationOptions =>
    post(koboUrls.create, { name, kind }),

  revoke: (id: number): ExpectMutationOptions => post(koboUrls.revoke, { id }),
};
