import type { APIResponse } from "@playwright/test";
import type { NewHighlight } from "../data/highlights";
import { BaseRequests } from "./BaseRequests";

/** The highlights a spec seeds and cleans up, as whoever owns the context. */
export class HighlightsRequests extends BaseRequests {
  /** Creates a highlight; the body is the stored highlight, with its `id`. */
  postHighlight(highlight: NewHighlight): Promise<APIResponse> {
    return this.post("/api/highlights", highlight);
  }

  /** Sets the note on a highlight, which creating one cannot carry. */
  patchHighlightNote(id: number, note: string): Promise<APIResponse> {
    return this.patch(`/api/highlights/${id}/note`, { note });
  }

  /** Every highlight the signed-in user has on the book. */
  getHighlights(bookUuid: string): Promise<APIResponse> {
    return this.get(`/api/highlights/book/${bookUuid}`);
  }

  deleteHighlight(id: number): Promise<APIResponse> {
    return this.delete(`/api/highlights/${id}`);
  }

  /** Sets the note; `postHighlight` takes none and would drop it silently. */
  patchNote(id: number, note: string): Promise<APIResponse> {
    return this.request.patch(`/api/highlights/${id}/note`, { data: { note } });
  }
}
