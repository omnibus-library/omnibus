import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** The log viewer's read, which `require_auth` gates to admins. */
export class LogViewerRequests extends BaseRequests {
  postLogs(query: { page: number; per_page: number }): Promise<APIResponse> {
    return this.post("/api/rpc/logs", { query });
  }
}
