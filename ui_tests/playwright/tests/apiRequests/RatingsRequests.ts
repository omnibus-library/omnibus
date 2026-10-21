import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** A book's star rating, set, read and cleared as whoever owns the context. */
export class RatingsRequests extends BaseRequests {
  postRating(bookUuid: string, stars: number): Promise<APIResponse> {
    return this.post("/api/ratings", { book_uuid: bookUuid, stars });
  }

  /** The record, or `null` when the reader has not rated the book. */
  getRating(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/ratings/${bookUuid}`);
  }

  /** Clearing a book the reader never rated still succeeds. */
  deleteRating(bookUuid: string): Promise<APIResponse> {
    return this.delete(`/api/ratings/${bookUuid}`);
  }
}
