import type { APIResponse } from "@playwright/test";
import type { NewHighlight } from "../data/highlights";
import { BaseRequests } from "./BaseRequests";

/** The highlights a spec seeds and cleans up, as whoever owns the context. */
export class HighlightsRequests extends BaseRequests {
  /** Creates a highlight; the body is the stored highlight, with its `id`. */
  postHighlight(highlight: NewHighlight): Promise<APIResponse> {
    return this.post("/api/highlights", highlight);
  }

  /** Every highlight the signed-in user has on the book. */
  getHighlights(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/highlights/book/${bookUuid}`);
  }

  deleteHighlight(id: number): Promise<APIResponse> {
    return this.delete(`/api/highlights/${id}`);
  }
}
