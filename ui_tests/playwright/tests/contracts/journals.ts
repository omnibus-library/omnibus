import type { ExpectMutationOptions } from "../utils/api";

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

function journalWrite(url: RegExp): ExpectMutationOptions {
  return { method: "POST", url, expectedStatus: 200 };
}

/** The writes a reader makes to their journal entries on a book. */
export const journals = {
  save: (): ExpectMutationOptions => journalWrite(journalsUrls.save),
  create: (): ExpectMutationOptions => journalWrite(journalsUrls.create),
  update: (): ExpectMutationOptions => journalWrite(journalsUrls.update),
  delete: (): ExpectMutationOptions => journalWrite(journalsUrls.delete),
  preview: (): ExpectMutationOptions => journalWrite(journalsUrls.preview),
  uploadImage: (): ExpectMutationOptions => journalWrite(journalsUrls.images),
};
