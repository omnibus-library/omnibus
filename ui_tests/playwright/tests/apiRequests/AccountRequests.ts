import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** The account preferences a spec presets, as whoever owns the context. */
export class AccountRequests extends BaseRequests {
  postScrollStops(enabled: boolean): Promise<APIResponse> {
    return this.post("/api/account/book-detail-scroll-stops", { enabled });
  }
}
