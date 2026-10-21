import type { APIResponse } from "@playwright/test";
import { BaseRequests } from "./BaseRequests";

/** The hosted MCP endpoint's instance-wide switch; needs an admin's context. */
export class McpRequests extends BaseRequests {
  postMcp(enabled: boolean): Promise<APIResponse> {
    return this.post("/api/settings/mcp", { enabled });
  }
}
