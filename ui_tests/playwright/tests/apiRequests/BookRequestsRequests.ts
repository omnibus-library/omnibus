import type { APIResponse } from "@playwright/test";
import type { RequestsConnectionsUpdate } from "../data/bookRequests";
import { BaseRequests } from "./BaseRequests";

/** The Prowlarr and download client connections, which are server-wide and need an admin's context, and the context's own requests. */
export class BookRequestsRequests extends BaseRequests {
  /** Starts an ebook request for the book, which searches at once. */
  startRequest(bookUuid: string): Promise<APIResponse> {
    return this.post(`/api/books/${bookUuid}/requests`, { kind: "ebook" });
  }

  getConnections(): Promise<APIResponse> {
    return this.get("/api/admin/requests/settings");
  }

  putConnections(update: RequestsConnectionsUpdate): Promise<APIResponse> {
    return this.put("/api/admin/requests/settings", update);
  }
}
