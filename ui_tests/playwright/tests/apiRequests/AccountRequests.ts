import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** The per-user switches under Settings → Account, as the context's user. */
export class AccountRequests extends BaseRequests {
  postScrollStops(enabled: boolean): Promise<APIResponse> {
    return this.post("/api/account/book-detail-scroll-stops", { enabled });
  }

  postShareStats(enabled: boolean): Promise<APIResponse> {
    return this.post("/api/account/share-stats", { enabled });
  }

  postStackSeries(enabled: boolean): Promise<APIResponse> {
    return this.post("/api/account/stack-series", { enabled });
  }
}
