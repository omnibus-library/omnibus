import { type ExpectMutationOptions, post } from "../utils/api";

/** The journal endpoints the book page posts to. */
export const journalsUrls = {
  /** A publish rides `create`, or `update` once the autosave made the draft. */
  save: /\/api\/rpc\/journals\/(?:create|update)(?:\?|$)/,
  create: /\/api\/rpc\/journals\/create(?:\?|$)/,
  update: /\/api\/rpc\/journals\/update(?:\?|$)/,
  delete: /\/api\/rpc\/journals\/delete(?:\?|$)/,
  preview: /\/api\/rpc\/journals\/preview(?:\?|$)/,
  images: /\/api\/journals\/images(?:\?|$)/,
};

/** The writes a reader makes to their journal entries on a book. */
export const journals = {
  save: (): ExpectMutationOptions => post(journalsUrls.save),
  create: (): ExpectMutationOptions => post(journalsUrls.create),
  update: (): ExpectMutationOptions => post(journalsUrls.update),
  delete: (): ExpectMutationOptions => post(journalsUrls.delete),
  preview: (): ExpectMutationOptions => post(journalsUrls.preview),
  uploadImage: (): ExpectMutationOptions => post(journalsUrls.images),
};
