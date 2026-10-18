import { type ExpectMutationOptions, post } from "../utils/api";

/** The Kobo device endpoints Settings › Devices reads and posts to. */
export const koboUrls = {
  list: /\/api\/rpc\/kobo\/devices(?:\?|$)/,
  regenerate: /\/api\/rpc\/kobo\/devices\/regenerate(?:\?|$)/,
  create: /\/api\/rpc\/kobo\/devices\/create(?:\?|$)/,
  revoke: /\/api\/rpc\/kobo\/devices\/revoke(?:\?|$)/,
};

/** The writes a reader makes to add and remove a Kobo device. */
export const koboDevices = {
  create: (name: string): ExpectMutationOptions =>
    post(koboUrls.create, { name }),

  revoke: (id: number): ExpectMutationOptions => post(koboUrls.revoke, { id }),
};
