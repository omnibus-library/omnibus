import type { APIResponse } from "@playwright/test";
import type { NewBookmark } from "../data/bookmarks";
import { BaseRequests } from "./BaseRequests";

/** The bookmarks a spec seeds and cleans up, as whoever owns the context. */
export class BookmarksRequests extends BaseRequests {
  /** Creates a bookmark; the body is the stored bookmark, with its `id`. */
  postBookmark(bookmark: NewBookmark): Promise<APIResponse> {
    return this.post("/api/bookmarks", bookmark);
  }

  deleteBookmark(id: number): Promise<APIResponse> {
    return this.delete(`/api/bookmarks/${id}`);
  }
}
