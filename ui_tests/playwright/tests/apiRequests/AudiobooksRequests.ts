import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** What the audio player reads about a book, as whoever owns the context. */
export class AudiobooksRequests extends BaseRequests {
  /** The book detail, whose `book_files` list the part each format plays. */
  getBookDetail(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/ebooks/${bookUuid}`);
  }
}
