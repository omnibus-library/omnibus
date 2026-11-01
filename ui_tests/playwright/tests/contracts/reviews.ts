import type { ReviewPatch } from "../data/reviews";
import type { ExpectMutationOptions } from "../utils/api";

/** `/api/reviews/{uuid}`: a GET reads the book's reviews, a PATCH and a DELETE write yours. */
export const reviewsUrls = {
  review: /\/api\/reviews\/[^/?]+(?:\?|$)/,
};

const reviewUrl = (bookUuid: string) =>
  new RegExp(`/api/reviews/${bookUuid}(?:\\?|$)`);

/** The writes a reader makes on their own review of a book. */
export const reviews = {
  /** A field-level patch: only the fields in `patch` are sent. */
  update: (bookUuid: string, patch: ReviewPatch): ExpectMutationOptions => ({
    method: "PATCH",
    url: reviewUrl(bookUuid),
    expectedBody: patch,
    expectedStatus: 200,
  }),

  delete: (bookUuid: string): ExpectMutationOptions => ({
    method: "DELETE",
    url: reviewUrl(bookUuid),
    expectedStatus: 204,
  }),
};
