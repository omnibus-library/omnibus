import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** A book's star rating, set and cleared as whoever owns the context. */
export class BookRatingRequests extends BaseRequests {
  postRating(bookUuid: string, stars: number): Promise<APIResponse> {
    return this.post("/api/ratings", { book_uuid: bookUuid, stars });
  }

  /** Clearing a book the reader never rated still succeeds. */
  deleteRating(bookUuid: string): Promise<APIResponse> {
    return this.delete(`/api/ratings/${bookUuid}`);
  }
}
