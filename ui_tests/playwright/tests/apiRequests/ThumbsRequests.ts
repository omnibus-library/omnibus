import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** Cover thumbnails, read as whoever owns the context. */
export class ThumbsRequests extends BaseRequests {
  /** The thumbnail of `bookUuid` at `size` (`sm`, `md`, …). */
  getThumbnail(bookUuid: string, size: string): Promise<APIResponse> {
    return this.get(`/api/thumbs/${bookUuid}/${size}`);
  }
}
