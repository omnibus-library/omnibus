import { type ExpectMutationOptions, post } from "../utils/api";

/** The journal endpoints the book page writes to. */
export const journalsUrls = {
  create: /\/api\/journals(?:\?|$)/,
  /** `/api/journals/{id}`: a PATCH updates the entry, a DELETE removes it. */
  entry: /\/api\/journals\/\d+(?:\?|$)/,
  preview: /\/api\/journals\/preview(?:\?|$)/,
  images: /\/api\/journals\/images(?:\?|$)/,
};

/** The writes a reader makes to their journal entries on a book. */
export const journals = {
  /** The composer's first write: a publish or Save draft before any autosave, or the autosave itself. */
  create: (): ExpectMutationOptions => post(journalsUrls.create),
  /** A publish once the autosave made the draft, an edit, or publishing a draft. */
  update: (): ExpectMutationOptions => ({
    method: "PATCH",
    url: journalsUrls.entry,
    expectedStatus: 200,
  }),
  delete: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: journalsUrls.entry,
    expectedStatus: 204,
  }),
  preview: (): ExpectMutationOptions => post(journalsUrls.preview),
  uploadImage: (): ExpectMutationOptions => post(journalsUrls.images),
};
