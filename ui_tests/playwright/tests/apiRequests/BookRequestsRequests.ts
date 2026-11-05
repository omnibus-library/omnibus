import type { APIResponse } from "@playwright/test";
import type { RequestsConnectionsUpdate } from "../data/bookRequests";
import { BaseRequests } from "./BaseRequests";

/** The Prowlarr and download client connections; server-wide, so it needs an admin's context. */
export class BookRequestsRequests extends BaseRequests {
  getConnections(): Promise<APIResponse> {
    return this.get("/api/admin/requests/settings");
  }

  putConnections(update: RequestsConnectionsUpdate): Promise<APIResponse> {
    return this.put("/api/admin/requests/settings", update);
  }
}
