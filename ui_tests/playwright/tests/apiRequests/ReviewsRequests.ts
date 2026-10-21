import type { APIResponse } from "@playwright/test";
import type { ReviewPatch } from "../data/reviews";
import { BaseRequests } from "./BaseRequests";

/** A book's reviews, and your own patched or deleted, as whoever owns the context. */
export class ReviewsRequests extends BaseRequests {
  getReviews(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/reviews/${bookUuid}`);
  }

  patchReview(bookUuid: string, patch: ReviewPatch): Promise<APIResponse> {
    return this.patch(`/api/reviews/${bookUuid}`, patch);
  }

  /** Deleting a review the reader never wrote still succeeds. */
  deleteReview(bookUuid: string): Promise<APIResponse> {
    return this.delete(`/api/reviews/${bookUuid}`);
  }
}
