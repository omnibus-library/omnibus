import type { APIResponse } from "@playwright/test";
import type {
  NotificationConnectionInput,
  PublicUrlStatus,
} from "../data/notifications";
import { BaseRequests } from "./BaseRequests";

/** The public server URL and the notification connections, which are server-wide; needs an admin. */
export class NotificationsRequests extends BaseRequests {
  getPublicUrl(): Promise<APIResponse> {
    return this.get("/api/settings/public-url");
  }

  postPublicUrl(url: PublicUrlStatus["url"]): Promise<APIResponse> {
    return this.post("/api/settings/public-url", { url });
  }

  getConnections(): Promise<APIResponse> {
    return this.get("/api/admin/notifications/connections");
  }

  postConnection(input: NotificationConnectionInput): Promise<APIResponse> {
    return this.post("/api/admin/notifications/connections", input);
  }

  deleteConnection(id: number): Promise<APIResponse> {
    return this.delete(`/api/admin/notifications/connections/${id}`);
  }
}
