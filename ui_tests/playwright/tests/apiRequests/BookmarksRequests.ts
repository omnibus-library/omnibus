import type { APIResponse } from "@playwright/test";
import type { NewBookmark } from "../data/bookmarks";
import { BaseRequests } from "./BaseRequests";

/** The bookmarks a spec seeds and cleans up, as whoever owns the context. */
export class BookmarksRequests extends BaseRequests {
  /** Creates a bookmark; the body is the stored bookmark, with its `id`. */
  postBookmark(bookmark: NewBookmark): Promise<APIResponse> {
    return this.post("/api/bookmarks", bookmark);
  }

  /** Every bookmark the signed-in user has on the book. */
  getBookmarks(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/bookmarks/book/${bookUuid}`);
  }

  deleteBookmark(id: number): Promise<APIResponse> {
    return this.delete(`/api/bookmarks/${id}`);
  }
}
