import type { ExpectMutationOptions } from "../utils/api";

/** The progress endpoints the reader posts to. */
export const progressUrls = {
  save: /\/api\/rpc\/progress(?:\?|$)/,
  get: /\/api\/rpc\/progress\/get(?:\?|$)/,
};

/** The writes the reader makes to the reader's saved position. */
export const progress = {
  /** The save a page turn makes. */
  save: (): ExpectMutationOptions => ({
    method: "POST",
    url: progressUrls.save,
    expectedStatus: 200,
  }),

  /** The save a contents jump makes, once the new chapter has rendered. */
  saveAfterJump: (): ExpectMutationOptions => ({
    ...progress.save(),
    timeout: 20_000,
  }),
};
