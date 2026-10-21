import type { ReviewPatch } from "../data/reviews";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The review endpoints the book page's Reviews section posts to. */
export const reviewsUrls = {
  /** The section's read, which a stars change or a delete re-runs. */
  get: /\/api\/rpc\/reviews\/get(?:\?|$)/,
  update: /\/api\/rpc\/reviews\/update(?:\?|$)/,
  delete: /\/api\/rpc\/reviews\/delete(?:\?|$)/,
};

/** The writes a reader makes on their own review of a book. */
export const reviews = {
  /** A field-level patch: only the fields in `patch` are sent. */
  update: (bookUuid: string, patch: ReviewPatch): ExpectMutationOptions =>
    post(reviewsUrls.update, { uuid: bookUuid, patch }),

  delete: (bookUuid: string): ExpectMutationOptions =>
    post(reviewsUrls.delete, { uuid: bookUuid }),
};
