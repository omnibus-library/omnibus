import type { APIResponse } from "@playwright/test";
import type { RatingUpdate } from "../data/ratings";
import { BaseRequests } from "./BaseRequests";

/** The ratings a spec seeds and clears, as whoever owns the context. */
export class RatingsRequests extends BaseRequests {
  postRating(update: RatingUpdate): Promise<APIResponse> {
    return this.post("/api/ratings", update);
  }

  /** The record, or `null` when the reader has not rated the book. */
  getRating(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/ratings/${bookUuid}`);
  }

  deleteRating(bookUuid: string): Promise<APIResponse> {
    return this.delete(`/api/ratings/${bookUuid}`);
  }
}
